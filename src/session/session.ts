import * as restate from "@restatedev/restate-sdk";
import { compact } from "../agents/compactor.js";
import { buildJournal, isFresh } from "../agents/journal.js";
import { runResearch } from "../agents/orchestrator.js";
import { truncate } from "../llm/format.js";
import type { Progress, TokenUsage, TraceEvent, Turn, TurnContext } from "./types.js";

// Long LLM steps (planner/synthesizer) make no journal progress while in flight,
// so raise Restate's inactivity timeout above the longest expected call; the
// abort timeout is the grace period before a stalled attempt is force-aborted.
// Require restate-server >= 1.4 (sent during service discovery).
const INACTIVITY_TIMEOUT_MS = Number(process.env.RESTATE_INACTIVITY_TIMEOUT_MS ?? 300_000);
const ABORT_TIMEOUT_MS = Number(process.env.RESTATE_ABORT_TIMEOUT_MS ?? 60_000);

// Conversation journal + compaction (Phase 7). Prior turns are fed to the
// planner/synthesizer so follow-ups reuse earlier work. Stale turns (older than
// FRESHNESS_TTL) drop out of the journal and are re-researched if asked again.
// When the journal's estimated size exceeds CONTEXT_MAX_TOKENS, the oldest
// verbatim turns are folded into a rolling summary, keeping the most recent
// MAX_JOURNAL_TURNS verbatim.
const FRESHNESS_TTL_MS = Number(process.env.FRESHNESS_TTL ?? 3600) * 1000;
const MAX_JOURNAL_TURNS = Number(process.env.MAX_JOURNAL_TURNS ?? 3);
const CONTEXT_MAX_TOKENS = Number(process.env.CONTEXT_MAX_TOKENS ?? 6000);
const JOURNAL_MAX_CHARS_PER_TURN = Number(process.env.JOURNAL_MAX_CHARS_PER_TURN ?? 1200);

// Tier-2 per-turn trace bound: cap stored TraceEvents so session state stays small.
const TRACE_MAX_EVENTS = Number(process.env.TRACE_MAX_EVENTS ?? 500);

interface SendTurnInput {
  message: string;
  /** Client-supplied turn id, so the caller can poll/await the exact turn it submitted. */
  turnId?: string;
}

async function loadTurns(
  ctx: restate.ObjectContext | restate.ObjectSharedContext,
): Promise<Record<string, Turn>> {
  return (await ctx.get<Record<string, Turn>>("turns")) ?? {};
}

/**
 * Assemble the conversation journal for a new turn from prior turns: a persisted
 * rolling `summary` plus the recent, fresh, not-yet-summarized turns. If the
 * estimated size exceeds CONTEXT_MAX_TOKENS, fold the oldest verbatim turns into
 * the summary via the durable compactor (keeping the most recent
 * MAX_JOURNAL_TURNS verbatim), persisting the new summary. Returns the journal
 * text plus a context snapshot for surfacing.
 */
async function buildSessionJournal(
  ctx: restate.ObjectContext,
  turns: Record<string, Turn>,
  order: string[],
  currentTurnId: string,
  now: number,
  usage: TokenUsage[],
  trace: TraceEvent[],
  persist: () => void,
): Promise<{ text: string; context: TurnContext }> {
  let summary = (await ctx.get<string>("journalSummary")) ?? "";
  const summarized = new Set((await ctx.get<string[]>("summarizedTurnIds")) ?? []);

  const prior = order
    .filter((id) => id !== currentTurnId)
    .map((id) => turns[id])
    .filter((t): t is Turn => t !== undefined && t.status === "done");
  let verbatim = prior.filter(
    (t) => !summarized.has(t.turnId) && isFresh(t.createdAt, now, FRESHNESS_TTL_MS),
  );

  let built = buildJournal(summary, verbatim, JOURNAL_MAX_CHARS_PER_TURN);
  let compacted = false;

  if (built.estimatedTokens > CONTEXT_MAX_TOKENS && verbatim.length > MAX_JOURNAL_TURNS) {
    ctx.set("compacting", true);
    const toFold = verbatim.slice(0, verbatim.length - MAX_JOURNAL_TURNS);
    const result = await compact(ctx, summary, toFold);
    usage.push(result.usage);
    trace.push({
      step: "compact",
      kind: "compact",
      model: result.usage.model,
      tokens: {
        in: result.usage.inputTokens,
        cached: result.usage.cachedTokens,
        out: result.usage.outputTokens,
      },
      detail: `folded ${toFold.length} older turn(s) into the summary`,
    });
    persist();

    summary = result.summary;
    for (const t of toFold) {
      summarized.add(t.turnId);
    }
    ctx.set("journalSummary", summary);
    ctx.set("summarizedTurnIds", [...summarized]);
    ctx.set("compacting", false);

    compacted = true;
    verbatim = verbatim.slice(verbatim.length - MAX_JOURNAL_TURNS);
    built = buildJournal(summary, verbatim, JOURNAL_MAX_CHARS_PER_TURN);
  }

  return {
    text: built.text,
    context: {
      priorTurnsUsed: verbatim.length + summarized.size,
      estimatedTokens: built.estimatedTokens,
      budgetTokens: CONTEXT_MAX_TOKENS,
      compacted,
    },
  };
}

/**
 * A research session, keyed by session id. Restate's single-writer guarantee
 * gives per-session isolation; its durable state persists turns across restarts.
 *
 * In Phase 3 a turn delegates the plan -> investigate -> synthesize flow to the
 * per-turn orchestrator (runResearch); the planner and synthesizer are real LLM
 * steps wrapped in ctx.run (completed calls replay, not re-issue, on resume),
 * while per-sub-question investigation is still stubbed until Phase 4. The Session
 * owns durable state: it persists progress via the orchestrator's hooks between
 * steps, keeping getProgress observable and letting a turn resume mid-flight.
 */
export const session = restate.object({
  name: "session",
  handlers: {
    start: async (
      ctx: restate.ObjectContext,
    ): Promise<{ sessionId: string; createdAt: number }> => {
      let createdAt = await ctx.get<number>("createdAt");
      if (createdAt === null) {
        createdAt = await ctx.date.now();
        ctx.set("createdAt", createdAt);
      }
      return { sessionId: ctx.key, createdAt };
    },

    sendTurn: async (
      ctx: restate.ObjectContext,
      input: SendTurnInput,
    ): Promise<{ turnId: string }> => {
      const message = input?.message;
      if (typeof message !== "string" || message.trim().length === 0) {
        throw new restate.TerminalError("message must be a non-empty string");
      }

      const now = await ctx.date.now();
      const turnId = input?.turnId ?? ctx.rand.uuidv4();
      const usage: TokenUsage[] = [];
      const toolCalls: Record<string, number> = {};
      const trace: TraceEvent[] = [];
      const turn: Turn = {
        turnId,
        message,
        status: "running",
        subQuestions: [],
        usage,
        toolCalls,
        trace,
        createdAt: now,
      };

      const turns = await loadTurns(ctx);
      const order = (await ctx.get<string[]>("order")) ?? [];
      turns[turnId] = turn;
      order.push(turnId);
      ctx.set("turns", turns);
      ctx.set("order", order);
      ctx.set("currentTurnId", turnId);
      ctx.console.info(
        `turn start session=${ctx.key} turn=${turnId} msg="${truncate(message, 120)}"`,
      );

      const persist = () => ctx.set("turns", turns);

      // Assemble the conversation journal from prior turns (compacting if it has
      // outgrown the token budget), so the planner/synthesizer reuse and build on
      // earlier work instead of restarting.
      const journal = await buildSessionJournal(
        ctx,
        turns,
        order,
        turnId,
        now,
        usage,
        trace,
        persist,
      );
      turn.context = journal.context;
      persist();

      try {
        // The orchestrator owns the plan -> investigate -> synthesize flow and
        // reports progress through these hooks; the Session owns durable state.
        turn.answer = await runResearch(
          ctx,
          message,
          {
            onUsage: (u) => {
              usage.push(u);
              persist();
            },
            onToolCall: (name) => {
              toolCalls[name] = (toolCalls[name] ?? 0) + 1;
              persist();
            },
            onSubQuestions: (questions) => {
              turn.subQuestions = questions.map((q) => ({ q, status: "pending" as const }));
              persist();
            },
            onInvestigationStart: (i) => {
              const sq = turn.subQuestions[i];
              if (sq) {
                sq.status = "running";
                persist();
              }
            },
            onInvestigationDone: (i, result) => {
              const sq = turn.subQuestions[i];
              if (sq) {
                sq.findings = result.findings;
                sq.sources = result.sources;
                sq.status = "done";
                persist();
              }
            },
            onTrace: (events) => {
              trace.push(...events);
              if (trace.length > TRACE_MAX_EVENTS) {
                trace.splice(0, trace.length - TRACE_MAX_EVENTS);
              }
              persist();
            },
          },
          journal.text,
        );
        turn.status = "done";
        persist();
        ctx.console.info(
          `turn done session=${ctx.key} turn=${turnId} subq=${turn.subQuestions.length}`,
        );
        return { turnId };
      } catch (err) {
        turn.status = "failed";
        persist();
        ctx.console.warn(`turn failed session=${ctx.key} turn=${turnId}`);
        throw err;
      }
    },

    getProgress: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext): Promise<Progress> => {
        const turns = await loadTurns(ctx);
        const currentTurnId = await ctx.get<string>("currentTurnId");
        const turn = currentTurnId ? turns[currentTurnId] : undefined;
        return {
          sessionId: ctx.key,
          status: turn?.status ?? "idle",
          currentTurnId,
          message: turn?.message ?? null,
          subQuestions: (turn?.subQuestions ?? []).map((sq) => ({ q: sq.q, status: sq.status })),
          compacting: (await ctx.get<boolean>("compacting")) ?? false,
        };
      },
    ),

    getResult: restate.handlers.object.shared(
      async (
        ctx: restate.ObjectSharedContext,
        input: { turnId?: string } = {},
      ): Promise<Turn | null> => {
        const turns = await loadTurns(ctx);
        const id = input?.turnId ?? (await ctx.get<string>("currentTurnId"));
        return id ? (turns[id] ?? null) : null;
      },
    ),

    getTrace: restate.handlers.object.shared(
      async (
        ctx: restate.ObjectSharedContext,
        input: { turnId?: string } = {},
      ): Promise<TraceEvent[]> => {
        const turns = await loadTurns(ctx);
        const id = input?.turnId ?? (await ctx.get<string>("currentTurnId"));
        const turn = id ? turns[id] : undefined;
        return turn?.trace ?? [];
      },
    ),

    getHistory: restate.handlers.object.shared(
      async (ctx: restate.ObjectSharedContext): Promise<Turn[]> => {
        const turns = await loadTurns(ctx);
        const order = (await ctx.get<string[]>("order")) ?? [];
        return order.map((id) => turns[id]).filter((t): t is Turn => Boolean(t));
      },
    ),
  },
  options: {
    inactivityTimeout: INACTIVITY_TIMEOUT_MS,
    abortTimeout: ABORT_TIMEOUT_MS,
  },
});

export type SessionObject = typeof session;

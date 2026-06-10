import * as restate from "@restatedev/restate-sdk";
import { runResearch } from "../agents/orchestrator.js";
import type { Progress, TokenUsage, Turn } from "./types.js";

// Long LLM steps (planner/synthesizer) make no journal progress while in flight,
// so raise Restate's inactivity timeout above the longest expected call; the
// abort timeout is the grace period before a stalled attempt is force-aborted.
// Require restate-server >= 1.4 (sent during service discovery).
const INACTIVITY_TIMEOUT_MS = Number(process.env.RESTATE_INACTIVITY_TIMEOUT_MS ?? 300_000);
const ABORT_TIMEOUT_MS = Number(process.env.RESTATE_ABORT_TIMEOUT_MS ?? 60_000);

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

      const turnId = input?.turnId ?? ctx.rand.uuidv4();
      const usage: TokenUsage[] = [];
      const toolCalls: Record<string, number> = {};
      const turn: Turn = {
        turnId,
        message,
        status: "running",
        subQuestions: [],
        usage,
        toolCalls,
        createdAt: await ctx.date.now(),
      };

      const turns = await loadTurns(ctx);
      const order = (await ctx.get<string[]>("order")) ?? [];
      turns[turnId] = turn;
      order.push(turnId);
      ctx.set("turns", turns);
      ctx.set("order", order);
      ctx.set("currentTurnId", turnId);

      const persist = () => ctx.set("turns", turns);

      try {
        // The orchestrator owns the plan -> investigate -> synthesize flow and
        // reports progress through these hooks; the Session owns durable state.
        turn.answer = await runResearch(ctx, message, {
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
        });
        turn.status = "done";
        persist();
        return { turnId };
      } catch (err) {
        turn.status = "failed";
        persist();
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

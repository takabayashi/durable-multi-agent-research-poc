import * as restate from "@restatedev/restate-sdk";
import { mockResearch } from "../mock/research.js";
import type { Progress, Turn } from "./types.js";

const MOCK_STEP_MS = Number(process.env.MOCK_STEP_MS ?? 800);

interface SendTurnInput {
  message: string;
}

async function loadTurns(
  ctx: restate.ObjectContext | restate.ObjectSharedContext,
): Promise<Record<string, Turn>> {
  return (await ctx.get<Record<string, Turn>>("turns")) ?? {};
}

/**
 * A research session, keyed by session id. Restate's single-writer guarantee
 * gives per-session isolation; its durable state persists turns across restarts.
 * Turns are mocked in Phase 2 (see mockResearch); the durable ctx.sleep loop
 * makes per-sub-question progress observable and resumable.
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

      const turnId = ctx.rand.uuidv4();
      const mock = mockResearch(message);
      const turn: Turn = {
        turnId,
        message,
        status: mock.subQuestions.length === 0 ? "done" : "running",
        subQuestions: mock.subQuestions.map((q) => ({ q, status: "pending" as const })),
        createdAt: await ctx.date.now(),
      };
      if (mock.subQuestions.length === 0) {
        turn.answer = mock.answer;
      }

      const turns = await loadTurns(ctx);
      const order = (await ctx.get<string[]>("order")) ?? [];
      turns[turnId] = turn;
      order.push(turnId);
      ctx.set("turns", turns);
      ctx.set("order", order);
      ctx.set("currentTurnId", turnId);

      // Advance each sub-question pending -> running -> done. The durable sleep
      // makes intermediate statuses visible to getProgress and lets the turn
      // resume mid-flight after a restart without redoing finished steps.
      for (const sq of turn.subQuestions) {
        sq.status = "running";
        ctx.set("turns", turns);
        await ctx.sleep(MOCK_STEP_MS);
        sq.status = "done";
        ctx.set("turns", turns);
      }

      if (turn.subQuestions.length > 0) {
        turn.status = "done";
        turn.answer = mock.answer;
        ctx.set("turns", turns);
      }

      return { turnId };
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
          subQuestions: turn?.subQuestions ?? [],
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
});

export type SessionObject = typeof session;

import * as restate from "@restatedev/restate-sdk";
import { composeGreeting } from "../greeting.js";

export interface GreetRequest {
  name?: string;
}

/**
 * Phase 0 smoke service: a single durable step that proves the Restate wiring
 * works end-to-end. The greeting is composed inside `ctx.run`, so the result is
 * journaled and replayed (not recomputed) if the invocation is retried.
 */
export const greeter = restate.service({
  name: "greeter",
  handlers: {
    greet: async (ctx: restate.Context, req: GreetRequest = {}): Promise<string> => {
      return ctx.run("compose-greeting", () => composeGreeting(req.name ?? "world"));
    },
  },
});

export type Greeter = typeof greeter;

import * as restate from "@restatedev/restate-sdk";
import OpenAI from "openai";

let client: OpenAI | undefined;

/**
 * Lazily construct a single OpenAI client from `OPENAI_API_KEY`. Called only
 * from inside `ctx.run`, so a missing key surfaces as a terminal error on the
 * turn (not at service startup) and `npm run check` never needs a key.
 *
 * Durability posture: `maxRetries` defaults to 0 so Restate's `ctx.run` is the
 * single durable retry authority, and a per-request `timeout` (kept below the
 * Restate inactivity timeout) bounds one attempt so a hung call fails fast and
 * is retried durably rather than treated as a stuck invocation. Both are
 * env-configurable.
 */
export function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new restate.TerminalError("OPENAI_API_KEY is not set");
  }
  if (!client) {
    client = new OpenAI({
      timeout: Number(process.env.OPENAI_TIMEOUT_MS ?? 120_000),
      maxRetries: Number(process.env.OPENAI_MAX_RETRIES ?? 0),
    });
  }
  return client;
}

import * as restate from "@restatedev/restate-sdk";
import OpenAI from "openai";

let client: OpenAI | undefined;

/**
 * Lazily construct a single OpenAI client from `OPENAI_API_KEY`. Called only
 * from inside `ctx.run`, so a missing key surfaces as a terminal error on the
 * turn (not at service startup) and `npm run check` never needs a key.
 */
export function getOpenAI(): OpenAI {
  if (!process.env.OPENAI_API_KEY) {
    throw new restate.TerminalError("OPENAI_API_KEY is not set");
  }
  if (!client) {
    client = new OpenAI();
  }
  return client;
}

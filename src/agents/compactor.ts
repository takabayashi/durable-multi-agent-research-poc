import type * as restate from "@restatedev/restate-sdk";
import { callStructured } from "../llm/wrapper.js";
import type { TokenUsage, Turn } from "../session/types.js";
import { compactorInput, SummarySchema } from "./compactor.prompt.js";

const COMPACTOR_MODEL =
  process.env.OPENAI_MODEL_COMPACTOR ?? process.env.OPENAI_MODEL_INVESTIGATOR ?? "gpt-5.4-mini";
const JOURNAL_MAX_CHARS_PER_TURN = Number(process.env.JOURNAL_MAX_CHARS_PER_TURN ?? 1200);

export interface CompactionResult {
  summary: string;
  usage: TokenUsage;
}

/**
 * Fold older turns into the running summary to keep the journal bounded. One
 * durable LLM step named "compact" — a completed call replays its journaled
 * summary (never re-summarizes) on resume. Runs on a cheap model since it is a
 * frequent, low-stakes step.
 */
export async function compact(
  ctx: restate.Context,
  existingSummary: string,
  turnsToFold: Turn[],
): Promise<CompactionResult> {
  const { data, usage } = await callStructured(ctx, {
    step: "compact",
    model: COMPACTOR_MODEL,
    schema: SummarySchema,
    schemaName: "context_summary",
    input: compactorInput(existingSummary, turnsToFold, JOURNAL_MAX_CHARS_PER_TURN),
  });
  return { summary: data.summary, usage };
}

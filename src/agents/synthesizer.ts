import type * as restate from "@restatedev/restate-sdk";
import { callStructured } from "../llm/wrapper.js";
import type { Answer, SubResult, TokenUsage } from "../session/types.js";
import { resolveCitations, SynthesisSchema, synthesizerInput } from "./synthesizer.prompt.js";

const SYNTHESIZER_MODEL = process.env.OPENAI_MODEL_SYNTHESIZER ?? "gpt-5.4";

export interface SynthesisResult {
  answer: Answer;
  usage: TokenUsage;
}

/**
 * Combine investigated sub-results into a structured, cited answer, reusing the
 * conversation journal for follow-up continuity. One durable LLM step named
 * "synthesizer".
 */
export async function synthesize(
  ctx: restate.Context,
  question: string,
  subResults: SubResult[],
  journal = "",
): Promise<SynthesisResult> {
  const { data, usage } = await callStructured(ctx, {
    step: "synthesizer",
    model: SYNTHESIZER_MODEL,
    schema: SynthesisSchema,
    schemaName: "research_synthesis",
    input: synthesizerInput(question, subResults, journal),
  });

  return {
    answer: { text: data.answer, citations: resolveCitations(data.citedSourceIds, subResults) },
    usage,
  };
}

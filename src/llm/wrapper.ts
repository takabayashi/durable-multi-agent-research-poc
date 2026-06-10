import * as restate from "@restatedev/restate-sdk";
import { zodTextFormat } from "openai/helpers/zod";
import type { z } from "zod";
import type { TokenUsage } from "../session/types.js";
import { getOpenAI } from "./client.js";
import { type PromptMessage, truncate } from "./format.js";

export interface CallStructuredOptions<S extends z.ZodType> {
  /** Stable, deterministic `ctx.run` step name (e.g. "planner", "synthesizer"). */
  step: string;
  model: string;
  schema: S;
  /** Schema name sent to the API (a short snake_case identifier). */
  schemaName: string;
  input: PromptMessage[];
}

export interface StructuredResult<T> {
  data: T;
  usage: TokenUsage;
}

/**
 * The single durable entry point for every LLM call. Runs entirely inside
 * `ctx.run(step)`, so the parsed result and token usage are journaled once and
 * replayed (never re-issued) on resume. Uses the Responses API with Zod
 * structured outputs; native parallel tool-calls are disabled to keep replay
 * deterministic (the convention that matters once tools land in Phase 4).
 */
export async function callStructured<S extends z.ZodType>(
  ctx: restate.Context,
  options: CallStructuredOptions<S>,
): Promise<StructuredResult<z.infer<S>>> {
  const { step, model, schema, schemaName, input } = options;

  return ctx.run(step, async (): Promise<StructuredResult<z.infer<S>>> => {
    const response = await getOpenAI().responses.parse({
      model,
      input,
      text: { format: zodTextFormat(schema, schemaName) },
      parallel_tool_calls: false,
    });

    const data = response.output_parsed as z.infer<S> | null;
    if (data == null) {
      throw new restate.TerminalError(`${step}: model returned no parseable output`);
    }

    const usage: TokenUsage = {
      step,
      model,
      inputTokens: response.usage?.input_tokens ?? 0,
      cachedTokens: response.usage?.input_tokens_details?.cached_tokens ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    };

    // Tier-1 structured log: stable step name + usage. Response is truncated and
    // we never log the prompt body or the API key.
    ctx.console.info(
      `llm step=${step} model=${model} tokens.in=${usage.inputTokens} tokens.cached=${usage.cachedTokens} tokens.out=${usage.outputTokens}`,
    );
    ctx.console.debug(`llm step=${step} output=${truncate(JSON.stringify(data))}`);

    return { data, usage };
  });
}

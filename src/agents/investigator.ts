import type * as restate from "@restatedev/restate-sdk";
import type OpenAI from "openai";
import { callTools } from "../llm/wrapper.js";
import type { SubResult, TokenUsage } from "../session/types.js";
import { collectSources, type FoundSource, runTool, TOOL_DEFS } from "../tools/registry.js";
import { investigatorInput } from "./investigator.prompt.js";

const INVESTIGATOR_MODEL = process.env.OPENAI_MODEL_INVESTIGATOR ?? "gpt-5.4-mini";
const MAX_TOOL_TURNS = Number(process.env.MAX_TOOL_TURNS ?? 5);

export interface InvestigationResult {
  result: SubResult;
  usage: TokenUsage[];
  /** Names of tools invoked during this investigation (e.g. "web_search"). */
  toolCalls: string[];
}

/**
 * Investigate one sub-question with a durable ReAct loop over web_search +
 * fetch_page. Each LLM turn and each tool call is its own ctx.run step with a
 * stable key, so completed steps replay (no duplicate external call) on resume.
 * Sources are derived from the URLs the tools actually returned; findings are the
 * model's final grounded answer. Degrades gracefully: after MAX_TOOL_TURNS it
 * makes one final tool-free call to summarize.
 */
export async function investigate(
  ctx: restate.Context,
  question: string,
  index: number,
): Promise<InvestigationResult> {
  const input: OpenAI.Responses.ResponseInputItem[] = [...investigatorInput(question)];
  const usage: TokenUsage[] = [];
  const found: FoundSource[] = [];
  const toolCalls: string[] = [];
  let findings = "";

  for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
    const res = await callTools(ctx, {
      step: `investigate:${index}:llm:${turn}`,
      model: INVESTIGATOR_MODEL,
      input,
      tools: TOOL_DEFS,
    });
    usage.push(res.usage);
    input.push(...res.outputItems);

    if (res.functionCalls.length === 0) {
      findings = res.text;
      break;
    }

    for (const [callIdx, call] of res.functionCalls.entries()) {
      const outcome = await ctx.run(`investigate:${index}:tool:${turn}:${callIdx}`, () =>
        runTool(call.name, call.args),
      );
      toolCalls.push(call.name);
      found.push(...outcome.found);
      input.push({
        type: "function_call_output",
        call_id: call.callId,
        output: outcome.outputForModel,
      });
    }
  }

  if (!findings) {
    const res = await callTools(ctx, {
      step: `investigate:${index}:llm:final`,
      model: INVESTIGATOR_MODEL,
      input: [
        ...input,
        { role: "user", content: "Summarize your findings so far. Do not call any tools." },
      ],
      tools: [],
    });
    usage.push(res.usage);
    findings = res.text || "(no findings: investigation did not converge)";
  }

  return {
    result: { q: question, findings, sources: collectSources(found, index) },
    usage,
    toolCalls,
  };
}

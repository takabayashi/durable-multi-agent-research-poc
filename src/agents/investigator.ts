import * as restate from "@restatedev/restate-sdk";
import type OpenAI from "openai";
import { truncate } from "../llm/format.js";
import { callTools } from "../llm/wrapper.js";
import type { SubResult, TokenUsage, TraceEvent } from "../session/types.js";
import { collectSources, type FoundSource, runTool, TOOL_DEFS } from "../tools/registry.js";
import { investigatorInput } from "./investigator.prompt.js";

const INVESTIGATOR_MODEL = process.env.OPENAI_MODEL_INVESTIGATOR ?? "gpt-5.4-mini";
const MAX_TOOL_TURNS = Number(process.env.MAX_TOOL_TURNS ?? 5);

// Each investigator runs a multi-step ReAct loop of long LLM calls; raise the
// inactivity timeout above the longest expected call so Restate doesn't treat an
// in-flight call as stuck (requires restate-server >= 1.4). See session.ts.
const INACTIVITY_TIMEOUT_MS = Number(process.env.RESTATE_INACTIVITY_TIMEOUT_MS ?? 300_000);
const ABORT_TIMEOUT_MS = Number(process.env.RESTATE_ABORT_TIMEOUT_MS ?? 60_000);

export interface InvestigateInput {
  question: string;
  /** Sub-question index within the turn; used to mint stable source ids S{index+1}-{k}. */
  index: number;
}

export interface InvestigationResult {
  result: SubResult;
  usage: TokenUsage[];
  /** Names of tools invoked during this investigation (e.g. "web_search"). */
  toolCalls: string[];
  /** Ordered Tier-2 trace fragment for this investigation (steps namespaced by index). */
  trace: TraceEvent[];
}

/**
 * Stateless investigator service. Each invocation investigates one sub-question
 * with a durable ReAct loop over web_search + fetch_page: every LLM turn and tool
 * call is its own ctx.run step, so completed steps replay (no duplicate external
 * call) on resume. Running it as a service lets the orchestrator fan out many
 * investigators concurrently — each is its own invocation/journal. Sources are
 * derived from the URLs the tools returned; findings are the model's grounded
 * answer; it degrades to a tool-free summary after MAX_TOOL_TURNS.
 */
export const investigator = restate.service({
  name: "investigator",
  handlers: {
    investigate: async (
      ctx: restate.Context,
      input: InvestigateInput,
    ): Promise<InvestigationResult> => {
      const { question, index } = input;
      const conversation: OpenAI.Responses.ResponseInputItem[] = [...investigatorInput(question)];
      const usage: TokenUsage[] = [];
      const found: FoundSource[] = [];
      const toolCalls: string[] = [];
      const trace: TraceEvent[] = [];
      let findings = "";

      for (let turn = 0; turn < MAX_TOOL_TURNS; turn++) {
        const step = `investigate:${index}:llm:${turn}`;
        const res = await callTools(ctx, {
          step,
          model: INVESTIGATOR_MODEL,
          input: conversation,
          tools: TOOL_DEFS,
        });
        usage.push(res.usage);
        conversation.push(...res.outputItems);
        trace.push({
          step,
          kind: "llm",
          model: INVESTIGATOR_MODEL,
          tokens: {
            in: res.usage.inputTokens,
            cached: res.usage.cachedTokens,
            out: res.usage.outputTokens,
          },
          detail:
            res.functionCalls.length > 0
              ? `requested ${res.functionCalls.length} tool call(s)`
              : truncate(res.text, 200),
        });

        if (res.functionCalls.length === 0) {
          findings = res.text;
          break;
        }

        for (const [callIdx, call] of res.functionCalls.entries()) {
          const toolStep = `investigate:${index}:tool:${turn}:${callIdx}`;
          const outcome = await ctx.run(toolStep, () => runTool(call.name, call.args));
          toolCalls.push(call.name);
          found.push(...outcome.found);
          // Tier-1 tool log: stable step name + tool name (args/results stay in the journal).
          ctx.console.info(`tool step=${toolStep} name=${call.name}`);
          trace.push({
            step: toolStep,
            kind: "tool",
            detail: `${call.name}: ${truncate(call.args, 120)}`,
          });
          conversation.push({
            type: "function_call_output",
            call_id: call.callId,
            output: outcome.outputForModel,
          });
        }
      }

      if (!findings) {
        const step = `investigate:${index}:llm:final`;
        const res = await callTools(ctx, {
          step,
          model: INVESTIGATOR_MODEL,
          input: [
            ...conversation,
            { role: "user", content: "Summarize your findings so far. Do not call any tools." },
          ],
          tools: [],
        });
        usage.push(res.usage);
        findings = res.text || "(no findings: investigation did not converge)";
        trace.push({
          step,
          kind: "llm",
          model: INVESTIGATOR_MODEL,
          tokens: {
            in: res.usage.inputTokens,
            cached: res.usage.cachedTokens,
            out: res.usage.outputTokens,
          },
          detail: truncate(findings, 200),
        });
      }

      return {
        result: { q: question, findings, sources: collectSources(found, index) },
        usage,
        toolCalls,
        trace,
      };
    },
  },
  options: {
    inactivityTimeout: INACTIVITY_TIMEOUT_MS,
    abortTimeout: ABORT_TIMEOUT_MS,
  },
});

export type Investigator = typeof investigator;

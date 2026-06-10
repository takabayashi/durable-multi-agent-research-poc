import type * as restate from "@restatedev/restate-sdk";
import type { Answer, SubResult, TokenUsage } from "../session/types.js";
import { investigate } from "./investigator.js";
import { plan } from "./planner.js";
import { synthesize } from "./synthesizer.js";

/**
 * Progress callbacks the orchestrator emits as it works. They let the Session
 * own all durable state while the orchestrator stays focused on the research
 * flow — it never touches session state directly.
 */
export interface ResearchHooks {
  /** A durable LLM step (planner or synthesizer) reported its token usage. */
  onUsage(usage: TokenUsage): void;
  /** A tool (web_search / fetch_page) was invoked during an investigation. */
  onToolCall(name: string): void;
  /** The planner produced the sub-questions to investigate. */
  onSubQuestions(questions: string[]): void;
  /** Investigation of the i-th sub-question has started. */
  onInvestigationStart(index: number): void;
  /** Investigation of the i-th sub-question has finished. */
  onInvestigationDone(index: number, result: SubResult): void;
}

/**
 * Per-turn orchestrator: plan -> investigate -> synthesize. Owns the research
 * *flow*; the caller (the Session) owns durable state and persists progress via
 * the hooks. Planner, investigators, and synthesizer are all real LLM work; each
 * investigator runs a durable ReAct loop over web_search + fetch_page. Phase 5
 * swaps the sequential loop for bounded parallel fan-out (RestatePromise.all)
 * without touching the Session.
 */
export async function runResearch(
  ctx: restate.Context,
  question: string,
  hooks: ResearchHooks,
): Promise<Answer> {
  // 1) Plan: decompose the question, or answer a trivial one directly.
  const planned = await plan(ctx, question);
  hooks.onUsage(planned.usage);

  if (planned.plan.trivial) {
    return { text: planned.plan.directAnswer, citations: [] };
  }

  // 2) Investigate each sub-question with a real ReAct loop over the tools,
  //    reporting observable progress.
  hooks.onSubQuestions(planned.plan.subQuestions);

  const subResults: SubResult[] = [];
  for (const [i, q] of planned.plan.subQuestions.entries()) {
    hooks.onInvestigationStart(i);
    const { result, usage, toolCalls } = await investigate(ctx, q, i);
    for (const u of usage) {
      hooks.onUsage(u);
    }
    for (const name of toolCalls) {
      hooks.onToolCall(name);
    }
    hooks.onInvestigationDone(i, result);
    subResults.push(result);
  }

  // 3) Synthesize a structured, cited answer.
  const synthesis = await synthesize(ctx, question, subResults);
  hooks.onUsage(synthesis.usage);
  return synthesis.answer;
}

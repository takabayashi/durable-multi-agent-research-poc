import * as restate from "@restatedev/restate-sdk";
import type { Answer, SubResult, TokenUsage } from "../session/types.js";
import { investigator } from "./investigator.js";
import { plan } from "./planner.js";
import { synthesize } from "./synthesizer.js";

const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY ?? 3);

/** Split a list into batches of at most `size` (size <= 0 -> a single batch). Pure. */
export function chunk<T>(items: T[], size: number): T[][] {
  const width = size > 0 ? size : items.length || 1;
  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += width) {
    batches.push(items.slice(i, i + width));
  }
  return batches;
}

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
 * the hooks. The planner and synthesizer are durable LLM steps; investigators run
 * as a separate stateless service, fanned out concurrently in batches of
 * MAX_CONCURRENCY (RestatePromise.all) and capped at MAX_SUBQUESTIONS breadth.
 */
export async function runResearch(
  ctx: restate.Context,
  question: string,
  hooks: ResearchHooks,
  journal = "",
): Promise<Answer> {
  // 1) Plan: using the conversation journal, emit only the NEW sub-questions
  //    still needed (possibly none — the journal may already suffice), or answer
  //    a trivial message directly.
  const planned = await plan(ctx, question, journal);
  hooks.onUsage(planned.usage);

  if (planned.plan.trivial) {
    return { text: planned.plan.directAnswer, citations: [] };
  }

  // 2) Investigate sub-questions concurrently, in batches of MAX_CONCURRENCY,
  //    via the stateless investigator service. Progress is reported per batch.
  hooks.onSubQuestions(planned.plan.subQuestions);

  const indexed = planned.plan.subQuestions.map((q, i) => ({ q, i }));
  const subResults: SubResult[] = [];
  for (const group of chunk(indexed, MAX_CONCURRENCY)) {
    for (const { i } of group) {
      hooks.onInvestigationStart(i);
    }
    const settled = await restate.RestatePromise.all(
      group.map(({ q, i }) =>
        ctx.serviceClient(investigator).investigate({ question: q, index: i }),
      ),
    );
    for (const [k, { i }] of group.entries()) {
      const r = settled[k];
      if (!r) {
        continue;
      }
      for (const u of r.usage) {
        hooks.onUsage(u);
      }
      for (const name of r.toolCalls) {
        hooks.onToolCall(name);
      }
      hooks.onInvestigationDone(i, r.result);
      subResults.push(r.result);
    }
  }

  // 3) Synthesize a structured, cited answer, reusing the journal for continuity
  //    (subResults may be empty when the journal already covers the message).
  const synthesis = await synthesize(ctx, question, subResults, journal);
  hooks.onUsage(synthesis.usage);
  return synthesis.answer;
}

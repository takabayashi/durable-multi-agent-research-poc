import type * as restate from "@restatedev/restate-sdk";
import { callStructured } from "../llm/wrapper.js";
import type { TokenUsage } from "../session/types.js";
import { applyBreadthCap, type Plan, PlanSchema, plannerInput } from "./planner.prompt.js";

const PLANNER_MODEL = process.env.OPENAI_MODEL_PLANNER ?? "gpt-5.4-nano";
const MAX_SUBQUESTIONS = Number(process.env.MAX_SUBQUESTIONS ?? 5);

export interface PlanResult {
  plan: Plan;
  usage: TokenUsage;
}

/**
 * Decompose a message into bounded NEW sub-questions, reusing the conversation
 * journal (so already-answered angles aren't re-investigated), or flag it
 * trivial for a direct answer. One durable LLM step named "planner".
 */
export async function plan(
  ctx: restate.Context,
  question: string,
  journal = "",
): Promise<PlanResult> {
  const { data, usage } = await callStructured(ctx, {
    step: "planner",
    model: PLANNER_MODEL,
    schema: PlanSchema,
    schemaName: "research_plan",
    input: plannerInput(question, MAX_SUBQUESTIONS, journal),
  });

  return { plan: applyBreadthCap(data, MAX_SUBQUESTIONS), usage };
}

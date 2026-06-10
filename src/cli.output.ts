/**
 * Pure presentation helpers for the CLI. Kept out of `cli.ts` so the entry file
 * stays thin (routing + Restate IO) and this formatting is unit-testable. These
 * functions are pure (data in, string out) — callers own the actual console IO.
 */
import type { Progress, TokenUsage, Turn } from "./session/types.js";

/** Render a one-shot progress snapshot: a status header plus its sub-questions. */
export function renderProgress(p: Progress): string {
  const header = `[${p.status}] ${p.message ?? "(no active turn)"}`;
  const lines = p.subQuestions.map((sq) => `  - [${sq.status}] ${sq.q}`);
  return [header, ...lines].join("\n");
}

interface UsageTotals {
  input: number;
  cached: number;
  output: number;
}

/** Sum a turn's per-step token usage into per-model totals. */
export function aggregateUsage(usage: TokenUsage[]): Map<string, UsageTotals> {
  const byModel = new Map<string, UsageTotals>();
  for (const u of usage) {
    const agg = byModel.get(u.model) ?? { input: 0, cached: 0, output: 0 };
    agg.input += u.inputTokens;
    agg.cached += u.cachedTokens;
    agg.output += u.outputTokens;
    byModel.set(u.model, agg);
  }
  return byModel;
}

/**
 * Format a finished turn's answer, citations, token usage and tool-call counts
 * as a single printable block, or an empty string when there is nothing to show
 * (so the caller can skip printing instead of emitting a blank line).
 */
export function formatTurnResult(turn: Turn): string {
  const parts: string[] = [];

  if (turn.answer) {
    parts.push(`\nAnswer:\n${turn.answer.text}`);
    if (turn.answer.citations.length > 0) {
      parts.push("\nSources:");
      for (const c of turn.answer.citations) {
        parts.push(`  - [${c.id}] ${c.title} (${c.url})`);
      }
    }
  }

  if (turn.usage && turn.usage.length > 0) {
    parts.push("\nTokens (this turn):");
    for (const [model, t] of aggregateUsage(turn.usage)) {
      parts.push(`  - ${model}: in=${t.input} cached=${t.cached} out=${t.output}`);
    }
  }

  if (turn.toolCalls && Object.keys(turn.toolCalls).length > 0) {
    parts.push("\nTool calls (this turn):");
    for (const [name, count] of Object.entries(turn.toolCalls)) {
      parts.push(`  - ${name}: ${count}`);
    }
  }

  return parts.join("\n");
}

/**
 * Pure helpers for the conversation "journal" — prior turns rendered as context
 * for the planner and synthesizer — plus a heuristic token estimate used to
 * decide when to compact. Pure (no IO), so they are unit-tested directly and
 * produce identical journals on replay.
 */
import { truncate } from "../llm/format.js";
import type { Turn } from "../session/types.js";

/** Heuristic token estimate (~4 chars/token). Good enough for budgeting. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Whether a turn created at `createdAt` is still within the freshness window. */
export function isFresh(createdAt: number, now: number, ttlMs: number): boolean {
  return now - createdAt <= ttlMs;
}

/** Render one prior turn as a compact, truncated journal entry. */
export function renderTurn(turn: Turn, maxChars: number): string {
  const findings = turn.subQuestions
    .filter((sq) => sq.findings)
    .map((sq) => `  - ${sq.q}: ${sq.findings}`)
    .join("\n");
  const lines = [`User asked: ${turn.message}`];
  if (findings) {
    lines.push(`Findings:\n${findings}`);
  }
  if (turn.answer?.text) {
    lines.push(`Answer: ${turn.answer.text}`);
  }
  return truncate(lines.join("\n"), maxChars);
}

export interface BuiltJournal {
  /** The rendered journal text (rolling summary + verbatim turns); "" if empty. */
  text: string;
  /** Heuristic token estimate of `text`. */
  estimatedTokens: number;
}

/**
 * Build the journal text from a rolling `summary` plus recent verbatim turns.
 * The caller decides which turns are verbatim (fresh and not yet summarized);
 * this only renders and estimates, so it stays pure and replay-stable.
 */
export function buildJournal(
  summary: string,
  verbatimTurns: Turn[],
  maxCharsPerTurn: number,
): BuiltJournal {
  const parts: string[] = [];
  if (summary.trim()) {
    parts.push(`SUMMARY OF EARLIER TURNS:\n${summary.trim()}`);
  }
  for (const turn of verbatimTurns) {
    parts.push(renderTurn(turn, maxCharsPerTurn));
  }
  const text = parts.join("\n\n");
  return { text, estimatedTokens: estimateTokens(text) };
}

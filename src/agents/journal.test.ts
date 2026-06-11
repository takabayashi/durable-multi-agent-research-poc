import { describe, expect, it } from "vitest";
import type { Turn } from "../session/types.js";
import { buildJournal, estimateTokens, isFresh, renderTurn } from "./journal.js";

function turn(partial: Partial<Turn>): Turn {
  return {
    turnId: "t1",
    message: "Q?",
    status: "done",
    subQuestions: [],
    createdAt: 0,
    ...partial,
  };
}

describe("estimateTokens", () => {
  it("approximates ~4 chars per token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("abcde")).toBe(2);
  });
});

describe("isFresh", () => {
  it("is true within the ttl and false beyond it", () => {
    expect(isFresh(1000, 2000, 1500)).toBe(true); // age 1000 <= 1500
    expect(isFresh(1000, 3000, 1500)).toBe(false); // age 2000 > 1500
  });
});

describe("renderTurn", () => {
  it("includes the question, findings, and answer", () => {
    const out = renderTurn(
      turn({
        message: "Compare A and B",
        subQuestions: [{ q: "A revenue?", status: "done", findings: "A grew 20%" }],
        answer: { text: "A grew faster than B", citations: [] },
      }),
      1000,
    );
    expect(out).toContain("User asked: Compare A and B");
    expect(out).toContain("A revenue?: A grew 20%");
    expect(out).toContain("Answer: A grew faster than B");
  });

  it("truncates to maxChars", () => {
    expect(renderTurn(turn({ message: "x".repeat(100) }), 20)).toContain("more chars)");
  });
});

describe("buildJournal", () => {
  it("returns empty text with no summary and no turns", () => {
    expect(buildJournal("", [], 1000)).toEqual({ text: "", estimatedTokens: 0 });
  });

  it("prepends the summary and includes each turn", () => {
    const { text } = buildJournal(
      "prior summary",
      [turn({ message: "Q1" }), turn({ message: "Q2" })],
      1000,
    );
    expect(text).toContain("SUMMARY OF EARLIER TURNS:\nprior summary");
    expect(text).toContain("User asked: Q1");
    expect(text).toContain("User asked: Q2");
  });
});

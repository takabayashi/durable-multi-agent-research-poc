import { describe, expect, it } from "vitest";
import { aggregateUsage, formatTurnResult, renderProgress, renderTrace } from "./cli.output";
import type { Progress, Turn } from "./session/types";

describe("renderProgress", () => {
  it("renders a status header and each sub-question", () => {
    const p: Progress = {
      sessionId: "s1",
      status: "running",
      currentTurnId: "t1",
      message: "Compare A and B",
      subQuestions: [
        { q: "What is A?", status: "done" },
        { q: "What is B?", status: "running" },
      ],
      compacting: false,
    };
    expect(renderProgress(p)).toBe(
      "[running] Compare A and B\n  - [done] What is A?\n  - [running] What is B?",
    );
  });

  it("appends a compaction indicator while compacting", () => {
    const p: Progress = {
      sessionId: "s1",
      status: "running",
      currentTurnId: "t1",
      message: "follow-up",
      subQuestions: [],
      compacting: true,
    };
    expect(renderProgress(p)).toContain("(compacting prior context");
  });

  it("falls back to a placeholder when there is no active turn", () => {
    const p: Progress = {
      sessionId: "s1",
      status: "idle",
      currentTurnId: null,
      message: null,
      subQuestions: [],
      compacting: false,
    };
    expect(renderProgress(p)).toBe("[idle] (no active turn)");
  });
});

describe("aggregateUsage", () => {
  it("sums token counts per model across steps", () => {
    const totals = aggregateUsage([
      { step: "planner", model: "gpt-x", inputTokens: 10, cachedTokens: 2, outputTokens: 5 },
      { step: "synthesizer", model: "gpt-x", inputTokens: 3, cachedTokens: 1, outputTokens: 4 },
      { step: "llm:0", model: "gpt-y", inputTokens: 7, cachedTokens: 0, outputTokens: 1 },
    ]);
    expect(totals.get("gpt-x")).toEqual({ input: 13, cached: 3, output: 9 });
    expect(totals.get("gpt-y")).toEqual({ input: 7, cached: 0, output: 1 });
  });
});

describe("formatTurnResult", () => {
  it("returns an empty string when there is nothing to show", () => {
    const turn: Turn = {
      turnId: "t1",
      message: "hi",
      status: "done",
      subQuestions: [],
      createdAt: 0,
    };
    expect(formatTurnResult(turn)).toBe("");
  });

  it("formats the answer, citations, token usage and tool calls byte-for-byte", () => {
    const turn: Turn = {
      turnId: "t1",
      message: "Compare A and B",
      status: "done",
      subQuestions: [],
      answer: {
        text: "A beats B.",
        citations: [{ id: "S1", title: "Source One", url: "https://example.com/1" }],
      },
      usage: [
        { step: "planner", model: "gpt-x", inputTokens: 10, cachedTokens: 2, outputTokens: 5 },
      ],
      toolCalls: { web_search: 2, fetch_page: 3 },
      createdAt: 0,
    };
    expect(formatTurnResult(turn)).toBe(
      [
        "",
        "Answer:",
        "A beats B.",
        "",
        "Sources:",
        "  - [S1] Source One (https://example.com/1)",
        "",
        "Tokens (this turn):",
        "  - gpt-x: in=10 cached=2 out=5",
        "",
        "Tool calls (this turn):",
        "  - web_search: 2",
        "  - fetch_page: 3",
      ].join("\n"),
    );
  });

  it("includes a context line when the turn carries a context snapshot", () => {
    const turn: Turn = {
      turnId: "t2",
      message: "go deeper",
      status: "done",
      subQuestions: [{ q: "deeper angle?", status: "done" }],
      answer: { text: "deeper answer", citations: [] },
      context: { priorTurnsUsed: 2, estimatedTokens: 1500, budgetTokens: 6000, compacted: true },
      createdAt: 0,
    };
    const out = formatTurnResult(turn);
    expect(out).toContain("reused 2 prior turn(s); investigated 1 new sub-question(s)");
    expect(out).toContain("journal ~1500 / 6000 tokens (compacted this turn)");
  });
});

describe("renderTrace", () => {
  it("returns a placeholder when there are no events", () => {
    expect(renderTrace([])).toBe("(no trace recorded for this turn)");
  });

  it("renders an ordered transcript with step, kind, model/tokens and detail", () => {
    const out = renderTrace([
      {
        step: "planner",
        kind: "plan",
        model: "gpt-x",
        tokens: { in: 10, cached: 2, out: 5 },
        detail: "planned 1 sub-question(s)",
      },
      { step: "investigate:0:tool:0:0", kind: "tool", detail: "web_search: datadog" },
    ]);
    expect(out).toBe(
      [
        "Trace (2 events):",
        "  - planner [plan] gpt-x in=10 cached=2 out=5",
        "      planned 1 sub-question(s)",
        "  - investigate:0:tool:0:0 [tool]",
        "      web_search: datadog",
      ].join("\n"),
    );
  });
});

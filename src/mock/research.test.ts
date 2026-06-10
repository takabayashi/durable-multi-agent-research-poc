import { describe, expect, it } from "vitest";
import { mockResearch } from "./research";

describe("mockResearch", () => {
  it("decomposes the canonical Datadog vs Snowflake query into parallel sub-questions", () => {
    const r = mockResearch("Compare Datadog and Snowflake over the last three years");
    expect(r.subQuestions.length).toBeGreaterThanOrEqual(3);
    expect(r.answer.citations.length).toBeGreaterThan(0);
  });

  it("returns an immediate answer (no sub-questions) for short definitional questions", () => {
    const r = mockResearch("What does NRR stand for?");
    expect(r.subQuestions).toHaveLength(0);
    expect(r.answer.text).toContain("Direct answer");
  });

  it("falls back to a generic decomposition for arbitrary topics", () => {
    const r = mockResearch("Postgres vs MySQL for high-write workloads");
    expect(r.subQuestions).toHaveLength(3);
    expect(r.answer.citations.length).toBeGreaterThan(0);
  });
});

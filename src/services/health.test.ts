import { describe, expect, it } from "vitest";
import { computeReadiness } from "./health";

describe("computeReadiness", () => {
  it("is ok when both required keys are present", () => {
    expect(computeReadiness({ OPENAI_API_KEY: "x", TAVILY_API_KEY: "y" })).toEqual({
      status: "ok",
      service: "durable-research",
      checks: { openai: true, tavily: true },
    });
  });

  it("is degraded when a required key is missing", () => {
    expect(computeReadiness({ OPENAI_API_KEY: "x" }).status).toBe("degraded");
    expect(computeReadiness({ TAVILY_API_KEY: "y" }).status).toBe("degraded");
    expect(computeReadiness({}).status).toBe("degraded");
  });

  it("reports per-dependency booleans without leaking secret values", () => {
    const r = computeReadiness({ OPENAI_API_KEY: "super-secret", TAVILY_API_KEY: "" });
    expect(r.checks).toEqual({ openai: true, tavily: false });
    expect(JSON.stringify(r)).not.toContain("super-secret");
  });
});

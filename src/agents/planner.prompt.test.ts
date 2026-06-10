import { describe, expect, it } from "vitest";
import { applyBreadthCap, type Plan, PlanSchema, plannerInput } from "./planner.prompt";

describe("plannerInput", () => {
  it("substitutes the breadth cap and frames the question as untrusted data", () => {
    const [system, user] = plannerInput("Compare A and B", 4);
    expect(system?.role).toBe("system");
    expect(system?.content).toContain("between 2 and 4");
    expect(system?.content).not.toContain("{MAX}");
    expect(user?.role).toBe("user");
    expect(user?.content).toContain("Compare A and B");
    expect(user?.content.toLowerCase()).toContain("untrusted data");
  });
});

describe("PlanSchema", () => {
  it("accepts a well-formed plan", () => {
    const parsed = PlanSchema.parse({ trivial: false, directAnswer: "", subQuestions: ["a", "b"] });
    expect(parsed.subQuestions).toHaveLength(2);
  });

  it("rejects a plan missing required fields", () => {
    expect(() => PlanSchema.parse({ subQuestions: [] })).toThrow();
  });
});

describe("applyBreadthCap", () => {
  it("caps the sub-question list to the max", () => {
    const plan: Plan = {
      trivial: false,
      directAnswer: "",
      subQuestions: ["1", "2", "3", "4", "5", "6"],
    };
    expect(applyBreadthCap(plan, 3).subQuestions).toEqual(["1", "2", "3"]);
  });

  it("forces an empty sub-question list for a trivial plan", () => {
    const plan: Plan = {
      trivial: true,
      directAnswer: "NRR = net revenue retention",
      subQuestions: ["should be dropped"],
    };
    const capped = applyBreadthCap(plan, 5);
    expect(capped.subQuestions).toEqual([]);
    expect(capped.directAnswer).toContain("net revenue retention");
  });
});

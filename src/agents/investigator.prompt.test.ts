import { describe, expect, it } from "vitest";
import { INVESTIGATOR_SYSTEM, investigatorInput } from "./investigator.prompt";

describe("investigatorInput", () => {
  it("includes the system prompt and frames the sub-question as untrusted data", () => {
    const [system, user] = investigatorInput("How big is the widget market?");
    expect(system?.role).toBe("system");
    expect(system?.content).toContain("web_search");
    expect(system?.content).toContain("fetch_page");
    expect(user?.content).toContain("How big is the widget market?");
    expect(user?.content.toLowerCase()).toContain("untrusted data");
  });

  it("instructs the model to treat tool output as data, not instructions", () => {
    expect(INVESTIGATOR_SYSTEM.toLowerCase()).toContain("untrusted");
    expect(INVESTIGATOR_SYSTEM.toLowerCase()).toContain("instructions");
  });
});

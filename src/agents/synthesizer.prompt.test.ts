import { describe, expect, it } from "vitest";
import type { SubResult } from "../session/types";
import {
  renderSubResults,
  resolveCitations,
  SynthesisSchema,
  synthesizerInput,
} from "./synthesizer.prompt";

const subResults: SubResult[] = [
  {
    q: "Revenue trend?",
    findings: "It grew.",
    sources: [{ id: "S1", title: "Investor relations", url: "https://example.com/s1" }],
  },
  {
    q: "Margin trend?",
    findings: "It improved.",
    sources: [{ id: "S2", title: "Annual report", url: "https://example.com/s2" }],
  },
];

describe("renderSubResults", () => {
  it("tags every source with its bracketed id", () => {
    const rendered = renderSubResults(subResults);
    expect(rendered).toContain("[S1] Investor relations — https://example.com/s1");
    expect(rendered).toContain("[S2] Annual report — https://example.com/s2");
    expect(rendered).toContain("sub-question: Revenue trend?");
  });
});

describe("synthesizerInput", () => {
  it("embeds the question and id-tagged sub-results as untrusted data", () => {
    const [system, user] = synthesizerInput("Compare A and B", subResults);
    expect(system?.content).toContain("citedSourceIds");
    expect(user?.content).toContain("Compare A and B");
    expect(user?.content).toContain("[S1]");
    expect(user?.content.toLowerCase()).toContain("untrusted data");
  });
});

describe("SynthesisSchema", () => {
  it("accepts answer + citedSourceIds", () => {
    const parsed = SynthesisSchema.parse({ answer: "x", citedSourceIds: ["S1"] });
    expect(parsed.citedSourceIds).toEqual(["S1"]);
  });
});

describe("resolveCitations", () => {
  it("resolves known ids to sources, preserving order and de-duplicating", () => {
    const citations = resolveCitations(["S2", "S1", "S2"], subResults);
    expect(citations.map((c) => c.id)).toEqual(["S2", "S1"]);
    expect(citations[0]?.url).toBe("https://example.com/s2");
  });

  it("drops unknown ids the model may have fabricated", () => {
    const citations = resolveCitations(["S1", "S99"], subResults);
    expect(citations.map((c) => c.id)).toEqual(["S1"]);
  });
});

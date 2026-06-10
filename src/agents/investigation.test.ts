import { describe, expect, it } from "vitest";
import { investigateStub } from "./investigation";

describe("investigateStub", () => {
  it("is deterministic and assigns stable per-index source ids", () => {
    const a = investigateStub("What is X?", 0);
    const b = investigateStub("What is X?", 0);
    expect(a).toEqual(b);
    expect(a.sources[0]?.id).toBe("S1");
    expect(investigateStub("Y?", 2).sources[0]?.id).toBe("S3");
  });

  it("echoes the sub-question and always provides a citable source", () => {
    const r = investigateStub("How big is the market?", 1);
    expect(r.q).toBe("How big is the market?");
    expect(r.findings).toContain("How big is the market?");
    expect(r.sources).toHaveLength(1);
    expect(r.sources[0]?.url).toContain("example.com");
  });
});

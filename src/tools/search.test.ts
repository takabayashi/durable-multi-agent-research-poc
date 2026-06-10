import { describe, expect, it } from "vitest";
import { mapTavilyResults } from "./search";

describe("mapTavilyResults", () => {
  it("maps + bounds results, filling title from url and dropping entries without a url", () => {
    const body = {
      results: [
        { title: "A", url: "https://a.com", content: "ca" },
        { url: "https://b.com" },
        { title: "no url here" },
        { title: "C", url: "https://c.com", content: "cc" },
      ],
    };
    const out = mapTavilyResults(body, 2);
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ title: "A", url: "https://a.com", content: "ca" });
    expect(out[1]).toEqual({ title: "https://b.com", url: "https://b.com", content: "" });
  });

  it("handles a missing or null results array", () => {
    expect(mapTavilyResults({}, 5)).toEqual([]);
    expect(mapTavilyResults(null, 5)).toEqual([]);
  });
});

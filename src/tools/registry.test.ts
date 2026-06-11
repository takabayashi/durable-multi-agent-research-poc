import { TerminalError } from "@restatedev/restate-sdk";
import { describe, expect, it } from "vitest";
import { FetchPageArgs } from "./fetch";
import { collectSources, runTool } from "./registry";
import { WebSearchArgs } from "./search";

describe("collectSources", () => {
  it("assigns stable S{index+1}-{k} ids and dedupes by normalized url", () => {
    const sources = collectSources(
      [
        { title: "A", url: "https://a.com/x" },
        { title: "A again", url: "https://a.com/x/" },
        { title: "B", url: "https://b.com" },
      ],
      0,
    );
    expect(sources).toHaveLength(2);
    expect(sources[0]).toEqual({ id: "S1-1", title: "A", url: "https://a.com/x" });
    expect(sources[1]?.id).toBe("S1-2");
  });

  it("uses the sub-question index in the ids", () => {
    const [s] = collectSources([{ title: "T", url: "https://t.com" }], 2);
    expect(s?.id).toBe("S3-1");
  });

  it("upgrades a url-fallback title when a real title arrives later (first-seen id kept)", () => {
    const [s] = collectSources(
      [
        { title: "https://a.com/x", url: "https://a.com/x" },
        { title: "Real Title", url: "https://a.com/x" },
      ],
      0,
    );
    expect(s).toEqual({ id: "S1-1", title: "Real Title", url: "https://a.com/x" });
  });

  it("drops invalid urls", () => {
    const sources = collectSources(
      [
        { title: "ok", url: "https://a.com" },
        { title: "bad", url: "not a url" },
      ],
      0,
    );
    expect(sources).toHaveLength(1);
    expect(sources[0]?.url).toBe("https://a.com");
  });

  it("caps the list at max", () => {
    const sources = collectSources(
      [
        { title: "a", url: "https://a.com" },
        { title: "b", url: "https://b.com" },
        { title: "c", url: "https://c.com" },
      ],
      0,
      2,
    );
    expect(sources).toHaveLength(2);
  });
});

describe("tool arg schemas", () => {
  it("validate required fields and reject bad input", () => {
    expect(WebSearchArgs.parse({ query: "x" }).query).toBe("x");
    expect(FetchPageArgs.parse({ url: "https://x.com" }).url).toBe("https://x.com");
    expect(() => WebSearchArgs.parse({})).toThrow();
    expect(() => FetchPageArgs.parse({ url: 123 })).toThrow();
  });
});

describe("runTool error handling (terminal vs retryable)", () => {
  it("fails terminally on non-JSON arguments", async () => {
    await expect(runTool("web_search", "not json")).rejects.toBeInstanceOf(TerminalError);
  });

  it("fails terminally on invalid web_search arguments (no retry of a doomed call)", async () => {
    await expect(runTool("web_search", "{}")).rejects.toBeInstanceOf(TerminalError);
  });

  it("fails terminally on invalid fetch_page arguments", async () => {
    await expect(runTool("fetch_page", JSON.stringify({ url: 123 }))).rejects.toBeInstanceOf(
      TerminalError,
    );
  });

  it("fails terminally on an unknown tool", async () => {
    await expect(runTool("nope", "{}")).rejects.toBeInstanceOf(TerminalError);
  });
});

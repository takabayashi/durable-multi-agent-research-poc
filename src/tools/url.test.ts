import { describe, expect, it } from "vitest";
import { normalizeUrl } from "./url";

describe("normalizeUrl", () => {
  it("lowercases the host and strips fragment + trailing slash (path case preserved)", () => {
    expect(normalizeUrl("https://Example.COM/Path/#frag")).toBe("https://example.com/Path");
  });

  it("drops tracking params but keeps meaningful ones", () => {
    expect(normalizeUrl("https://x.com/a?utm_source=n&id=2&fbclid=z")).toBe("https://x.com/a?id=2");
  });

  it("keeps the root slash", () => {
    expect(normalizeUrl("https://x.com/")).toBe("https://x.com/");
  });

  it("treats trailing-slash and fragment variants as the same dedup key", () => {
    expect(normalizeUrl("https://x.com/a/")).toBe(normalizeUrl("https://x.com/a#top"));
  });

  it("returns null for non-http(s) or unparseable urls", () => {
    expect(normalizeUrl("ftp://x.com/a")).toBeNull();
    expect(normalizeUrl("not a url")).toBeNull();
  });
});

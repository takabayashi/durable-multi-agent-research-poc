import { describe, expect, it } from "vitest";
import { extractReadable, normalizeText } from "./fetch";

describe("normalizeText", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeText("  a\n\n  b\t c  ")).toBe("a b c");
  });

  it("truncates beyond max with a marker", () => {
    const out = normalizeText("abcdefghij", 4);
    expect(out.startsWith("abcd")).toBe(true);
    expect(out).toContain("[truncated]");
  });
});

describe("extractReadable", () => {
  const html = `<!doctype html><html><head><title>Test Article</title></head><body>
    <nav>Home About Contact</nav>
    <article><h1>Widget Report</h1>
      <p>Widgets grew twenty percent in 2025 according to the annual report.</p>
      <p>Operating margins improved across every region last year as well.</p>
    </article>
    <footer>Copyright 2026</footer>
  </body></html>`;

  it("extracts the main text and a non-empty title", () => {
    const { title, text } = extractReadable(html, "https://x.com/report");
    expect(title.length).toBeGreaterThan(0);
    expect(text).toContain("Widgets grew twenty percent");
    expect(text).toContain("Operating margins improved");
  });

  it("falls back to the url as title for body-only html", () => {
    const { title, text } = extractReadable(
      "<html><body><p>Hello world content here</p></body></html>",
      "https://y.com",
    );
    expect(text).toContain("Hello world content here");
    expect(title).toBe("https://y.com");
  });
});

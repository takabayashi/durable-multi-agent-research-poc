import { Readability } from "@mozilla/readability";
import { parseHTML } from "linkedom";
import type OpenAI from "openai";
import { z } from "zod";

const MAX_CHARS = Number(process.env.FETCH_PAGE_MAX_CHARS ?? 6000);

export interface PageContent {
  title: string;
  url: string;
  text: string;
}

export const FetchPageArgs = z.object({
  url: z.string(),
});
export type FetchPageArgs = z.infer<typeof FetchPageArgs>;

/** Function-tool definition advertised to the model. */
export const fetchPageTool: OpenAI.Responses.Tool = {
  type: "function",
  name: "fetch_page",
  description:
    "Fetch a web page by URL and return its main readable text. Use this to read a promising source found via web_search.",
  strict: true,
  parameters: {
    type: "object",
    properties: { url: { type: "string", description: "The absolute URL to fetch." } },
    required: ["url"],
    additionalProperties: false,
  },
};

/** Pure: collapse whitespace and bound length for safe, token-efficient text. */
export function normalizeText(text: string, maxChars = MAX_CHARS): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length <= maxChars ? collapsed : `${collapsed.slice(0, maxChars)}… [truncated]`;
}

/**
 * Pure: extract main-content text from HTML using Mozilla Readability over a
 * linkedom DOM, falling back to the document body for non-article pages. Returns
 * a bounded, normalized text plus a best-effort title.
 */
export function extractReadable(html: string, url: string): { title: string; text: string } {
  const { document } = parseHTML(html);

  let title = "";
  let body = "";
  try {
    const article = new Readability(
      document as unknown as ConstructorParameters<typeof Readability>[0],
    ).parse();
    if (article) {
      title = article.title ?? "";
      body = article.textContent ?? "";
    }
  } catch {
    // Non-article or unparseable content: fall back to the raw body text below.
  }

  if (!body) {
    body = document.querySelector("body")?.textContent ?? "";
  }
  if (!title) {
    title = document.querySelector("title")?.textContent ?? "";
  }

  return { title: title.trim() || url, text: normalizeText(body) };
}

/** Durable-step body (wrapped in ctx.run by the investigator). */
export async function fetchPage(args: FetchPageArgs): Promise<PageContent> {
  const res = await fetch(args.url, { signal: AbortSignal.timeout(20_000), redirect: "follow" });
  if (!res.ok) {
    // Degrade gracefully: report the failure to the model rather than throwing
    // (which would trigger ctx.run retries for a likely-permanent error).
    return { title: args.url, url: args.url, text: `(failed to fetch page: HTTP ${res.status})` };
  }

  const raw = await res.text();
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("html") && !contentType.includes("text")) {
    return { title: args.url, url: args.url, text: normalizeText(raw) };
  }

  const { title, text } = extractReadable(raw, args.url);
  return { title, url: args.url, text };
}

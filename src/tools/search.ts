import * as restate from "@restatedev/restate-sdk";
import type OpenAI from "openai";
import { z } from "zod";

const TAVILY_URL = "https://api.tavily.com/search";
const MAX_RESULTS = Number(process.env.WEB_SEARCH_MAX_RESULTS ?? 5);

export interface SearchResult {
  title: string;
  url: string;
  content: string;
}

export const WebSearchArgs = z.object({
  query: z.string(),
});
export type WebSearchArgs = z.infer<typeof WebSearchArgs>;

/** Function-tool definition advertised to the model. */
export const webSearchTool: OpenAI.Responses.Tool = {
  type: "function",
  name: "web_search",
  description:
    "Search the web for sources relevant to the sub-question. Returns a ranked list of titles, URLs, and short content snippets.",
  strict: true,
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "The search query." } },
    required: ["query"],
    additionalProperties: false,
  },
};

interface TavilyResult {
  title?: string;
  url?: string;
  content?: string;
}

/** Pure: map a Tavily response body to bounded {title,url,content} results. */
export function mapTavilyResults(body: unknown, maxResults = MAX_RESULTS): SearchResult[] {
  const results = (body as { results?: TavilyResult[] } | null)?.results ?? [];
  return results
    .filter(
      (r): r is TavilyResult & { url: string } => typeof r?.url === "string" && r.url.length > 0,
    )
    .slice(0, maxResults)
    .map((r) => ({
      title: (r.title ?? r.url).trim(),
      url: r.url,
      content: (r.content ?? "").trim(),
    }));
}

/** Durable-step body (wrapped in ctx.run by the investigator). */
export async function webSearch(args: WebSearchArgs): Promise<SearchResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new restate.TerminalError("TAVILY_API_KEY is not set");
  }

  const res = await fetch(TAVILY_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ query: args.query, max_results: MAX_RESULTS, search_depth: "basic" }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`Tavily search failed (${res.status}): ${detail.slice(0, 200)}`);
  }
  return mapTavilyResults(await res.json());
}

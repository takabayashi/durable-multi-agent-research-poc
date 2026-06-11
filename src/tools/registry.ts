import * as restate from "@restatedev/restate-sdk";
import type { Source } from "../session/types.js";
import { FetchPageArgs, fetchPage, fetchPageTool } from "./fetch.js";
import { WebSearchArgs, webSearch, webSearchTool } from "./search.js";
import { normalizeUrl } from "./url.js";

const MAX_SOURCES = Number(process.env.MAX_SOURCES ?? 8);

/** The tools advertised to the model. */
export const TOOL_DEFS = [webSearchTool, fetchPageTool];

/** A title+URL surfaced by a tool, before it becomes a cited Source. */
export interface FoundSource {
  title: string;
  url: string;
}

export interface ToolOutcome {
  /** String fed back to the model as the function_call_output. */
  outputForModel: string;
  /** Title/URL pairs the tool surfaced, for source collection. */
  found: FoundSource[];
}

/**
 * Validate the model's tool arguments and dispatch to the concrete tool. Thrown
 * errors propagate to the surrounding `ctx.run` (TerminalError = no retry).
 */
export async function runTool(name: string, argsJson: string): Promise<ToolOutcome> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(argsJson);
  } catch {
    throw new restate.TerminalError(`tool "${name}": arguments are not valid JSON`);
  }

  switch (name) {
    case "web_search": {
      // Invalid model-supplied args are permanent: fail terminally so ctx.run
      // doesn't retry a call that can never succeed. (Transient Tavily/network
      // failures inside webSearch stay retryable.)
      const args = WebSearchArgs.safeParse(parsed);
      if (!args.success) {
        throw new restate.TerminalError('tool "web_search": invalid arguments');
      }
      const results = await webSearch({ query: args.data.query });
      const rendered = results
        .map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.content}`)
        .join("\n\n");
      return {
        outputForModel: rendered || "(no results)",
        found: results.map((r) => ({ title: r.title, url: r.url })),
      };
    }
    case "fetch_page": {
      const args = FetchPageArgs.safeParse(parsed);
      if (!args.success) {
        throw new restate.TerminalError('tool "fetch_page": invalid arguments');
      }
      const page = await fetchPage({ url: args.data.url });
      return {
        outputForModel: `TITLE: ${page.title}\nURL: ${page.url}\n\n${page.text}`,
        found: [{ title: page.title, url: page.url }],
      };
    }
    default:
      throw new restate.TerminalError(`unknown tool: ${name}`);
  }
}

/**
 * Pure: turn the title/URL pairs surfaced during one sub-question's investigation
 * into stable, de-duped Sources. Keyed by a light-normalized URL: the first
 * occurrence keeps its id `S{index+1}-{k}` (citation stability), and a later,
 * richer title upgrades a URL-fallback title. Invalid URLs are dropped; the list
 * is capped at MAX_SOURCES.
 */
export function collectSources(found: FoundSource[], index: number, max = MAX_SOURCES): Source[] {
  const byKey = new Map<string, Source>();
  const order: string[] = [];

  for (const f of found) {
    const key = normalizeUrl(f.url);
    if (!key) {
      continue;
    }
    const existing = byKey.get(key);
    if (existing) {
      const hasRealTitle = f.title && f.title !== f.url;
      if (hasRealTitle && existing.title === existing.url) {
        existing.title = f.title;
      }
      continue;
    }
    if (order.length >= max) {
      continue;
    }
    const source: Source = {
      id: `S${index + 1}-${order.length + 1}`,
      title: f.title || f.url,
      url: f.url,
    };
    byKey.set(key, source);
    order.push(key);
  }

  return order.map((key) => byKey.get(key) as Source);
}

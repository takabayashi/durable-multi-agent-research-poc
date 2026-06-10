import type { SubResult } from "../session/types.js";

/**
 * Deterministic stand-in for the real investigator. Phase 4 replaces this with a
 * durable ReAct loop over `web_search` + `fetch_page`; for now it returns a stub
 * finding plus one stub source with a stable per-turn id ("S1", "S2", ...), so
 * the synthesizer has concrete, citable sources to work with.
 *
 * Pure and side-effect free: callers wrap it in `ctx.run` for durability, and it
 * is directly unit-testable.
 */
export function investigateStub(question: string, index: number): SubResult {
  const id = `S${index + 1}`;
  return {
    q: question,
    findings: `(stub) Findings for "${question}" will be produced by the real investigator in Phase 4.`,
    sources: [
      {
        id,
        title: `Stub source for sub-question ${index + 1}`,
        url: `https://example.com/${id.toLowerCase()}`,
      },
    ],
  };
}

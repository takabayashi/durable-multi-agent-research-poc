import type { Answer } from "../session/types.js";

export interface MockResearch {
  subQuestions: string[];
  answer: Answer;
}

const DEFINITIONAL = /^\s*(what|who|when|where)\s+(is|are|does|do|did)\b/i;

function isDefinitional(message: string): boolean {
  return DEFINITIONAL.test(message) && message.trim().length <= 80;
}

function mentionsAll(haystack: string, needles: string[]): boolean {
  const lower = haystack.toLowerCase();
  return needles.every((n) => lower.includes(n));
}

/**
 * Deterministic stand-in for the real research pipeline (Phase 3+).
 * Given a user message, returns the sub-questions to "investigate" and a canned
 * cited answer. Pure and side-effect free, so it is unit-testable and produces
 * the same journal on replay when called from a durable handler.
 */
export function mockResearch(message: string): MockResearch {
  // Immediate-answer branch: short definitional questions need no decomposition.
  if (isDefinitional(message)) {
    return {
      subQuestions: [],
      answer: {
        text: `(mock) Direct answer to: "${message.trim()}". No decomposition was needed.`,
        citations: [],
      },
    };
  }

  // Canonical demo query: Datadog vs Snowflake comparison.
  if (mentionsAll(message, ["datadog", "snowflake"])) {
    return {
      subQuestions: [
        "Datadog revenue, growth, and margins over the last three years",
        "Snowflake revenue, growth, and margins over the last three years",
        "Net revenue retention (NRR) trends for Datadog and Snowflake",
        "Profitability and free-cash-flow comparison",
      ],
      answer: {
        text:
          "(mock) Over the last three years both companies grew quickly while improving margins; " +
          "Snowflake posted higher revenue growth off a larger base, Datadog reached GAAP " +
          "profitability sooner, and both saw NRR moderate from peak levels. Figures are " +
          "placeholders until the real pipeline lands.",
        citations: [
          { title: "Datadog investor relations", url: "https://example.com/datadog-ir" },
          { title: "Snowflake investor relations", url: "https://example.com/snowflake-ir" },
        ],
      },
    };
  }

  // Generic fallback: a small, deterministic decomposition.
  const topic = message.trim();
  return {
    subQuestions: [
      `Background and definitions for: ${topic}`,
      `Key facts and current state of: ${topic}`,
      `Recent developments and outlook for: ${topic}`,
    ],
    answer: {
      text: `(mock) Synthesized overview of "${topic}" based on the sub-questions above.`,
      citations: [{ title: "Example source", url: "https://example.com/source" }],
    },
  };
}

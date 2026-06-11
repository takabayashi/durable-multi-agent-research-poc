import { describe, expect, it } from "vitest";
import type { PromptMessage } from "../llm/format.js";
import type { Turn } from "../session/types.js";
import { compactorInput } from "./compactor.prompt.js";

function turn(message: string): Turn {
  return { turnId: message, message, status: "done", subQuestions: [], createdAt: 0 };
}

function text(messages: PromptMessage[]): string {
  return messages.map((m) => m.content).join("\n");
}

describe("compactorInput", () => {
  it("includes the existing summary and the older turns", () => {
    const out = text(compactorInput("prior summary", [turn("Q1"), turn("Q2")], 1000));
    expect(out).toContain("prior summary");
    expect(out).toContain("User asked: Q1");
    expect(out).toContain("User asked: Q2");
  });

  it("shows (none) when there is no existing summary", () => {
    expect(text(compactorInput("", [turn("Q1")], 1000))).toContain("(none)");
  });
});

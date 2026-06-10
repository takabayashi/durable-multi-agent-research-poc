import { describe, expect, it } from "vitest";
import { chunk } from "./orchestrator";

describe("chunk", () => {
  it("splits into batches of at most size, with the remainder last", () => {
    expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("returns a single batch when size >= length", () => {
    expect(chunk([1, 2, 3], 5)).toEqual([[1, 2, 3]]);
  });

  it("returns an empty array for no items", () => {
    expect(chunk([], 3)).toEqual([]);
  });

  it("falls back to a single batch for size <= 0", () => {
    expect(chunk([1, 2, 3], 0)).toEqual([[1, 2, 3]]);
  });
});

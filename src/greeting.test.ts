import { describe, it, expect } from "vitest";
import { composeGreeting } from "./greeting";

describe("composeGreeting", () => {
  it("greets a provided name", () => {
    expect(composeGreeting("Ada")).toBe("Hello, Ada! This durable greeter is alive.");
  });

  it("trims surrounding whitespace", () => {
    expect(composeGreeting("  Ada  ")).toBe("Hello, Ada! This durable greeter is alive.");
  });

  it("falls back to 'world' for blank input", () => {
    expect(composeGreeting("   ")).toBe("Hello, world! This durable greeter is alive.");
  });
});

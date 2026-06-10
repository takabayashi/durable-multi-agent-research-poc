/**
 * Pure greeting logic, kept separate from the Restate handler so it can be
 * unit-tested without a running Restate server. (Phase 0 smoke logic.)
 */
export function composeGreeting(name: string): string {
  const cleaned = name.trim();
  const who = cleaned.length > 0 ? cleaned : "world";
  return `Hello, ${who}! This durable greeter is alive.`;
}

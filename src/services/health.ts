import * as restate from "@restatedev/restate-sdk";

export interface Readiness {
  status: "ok" | "degraded";
  service: string;
  /** Which external dependencies are configured (presence only — never the values). */
  checks: { openai: boolean; tavily: boolean };
}

/**
 * Pure readiness from environment presence. Reports booleans only, never secret
 * values, so the result is safe to expose. "degraded" means a required key is
 * missing (live turns will fail) while the process itself is up and serving.
 */
export function computeReadiness(env: NodeJS.ProcessEnv): Readiness {
  const openai = Boolean(env.OPENAI_API_KEY);
  const tavily = Boolean(env.TAVILY_API_KEY);
  return {
    status: openai && tavily ? "ok" : "degraded",
    service: "durable-research",
    checks: { openai, tavily },
  };
}

/**
 * Application readiness handler. Complements the SDK endpoint's built-in
 * `GET :9080/health` liveness route (which only proves the process is serving)
 * by reporting whether the service's external dependencies are configured.
 * Invoke through the Restate ingress: `health/check`.
 */
export const health = restate.service({
  name: "health",
  handlers: {
    check: async (_ctx: restate.Context): Promise<Readiness> => computeReadiness(process.env),
  },
});

export type Health = typeof health;

# Decisions

A running log of meaningful technical and architectural decisions. New entries are appended under the
current phase heading; past entries are never deleted (a changed decision is superseded by a new entry
that references it).

---

## Phase 0 — Planning & setup

### Language & SDK: TypeScript + Restate
- **Decision:** Build the service in TypeScript using `@restatedev/restate-sdk` (handlers) and
  `@restatedev/restate-sdk-clients` (CLI).
- **Alternatives:** Python or Go Restate SDKs.
- **Rationale / trade-offs:** TypeScript has the most mature Restate SDK and the richest LLM/agent
  ecosystem, letting us move fastest. We give up Python's slightly terser AI glue.
- **Made by:** Human+Agent
- **Date:** 2026-06-09

### LLM orchestration: hand-rolled agent loop on raw `openai` + `ctx.run`
- **Decision:** Manage the agent loop ourselves with the raw `openai` SDK; wrap every LLM call and tool
  call in `ctx.run` for durability.
- **Alternatives:** An agent framework (LangGraph, OpenAI Agents SDK, Vercel AI SDK) layered on Restate.
- **Rationale / trade-offs:** Maximum control and the clearest demonstration of Restate primitives; no
  framework abstraction to fight when reasoning about determinism/replay. We give up some framework
  conveniences (built-in tool plumbing, memory).
- **Made by:** Human+Agent
- **Date:** 2026-06-09

### Agent topology: orchestrator-workers + per-investigator ReAct loop
- **Decision:** An orchestrator does `plan → fan-out workers → synthesize`; each investigator runs a
  ReAct (reason+act) tool loop for one sub-question.
- **Alternatives:** A single monolithic agent loop; a sequential investigation loop.
- **Rationale / trade-offs:** Matches the problem (decompose → parallel investigate → synthesize),
  enables real parallelism and clean per-sub-question durability. Slightly more moving parts than a
  single loop.
- **Made by:** Human+Agent
- **Date:** 2026-06-09

### Sub-agent shape: stateless Service investigators + aggregate progress in the Session object
- **Decision:** Investigators are stateless Restate Service handlers; the Session Virtual Object owns
  durable state and exposes aggregate progress via a shared `getProgress` handler.
- **Alternatives:** Investigators as their own Virtual Objects (individually addressable, live
  per-subagent progress/metrics).
- **Rationale / trade-offs:** Simpler, and lossless — "stateless" Services are still durably journaled,
  so partial work is never lost; live per-subagent detail is available via the Restate UI. We defer
  individually addressable subagents as a possible upgrade.
- **Made by:** Human+Agent
- **Date:** 2026-06-09

### Bounded concurrency: agentic breadth (capped) + enforced concurrency guardrail
- **Decision:** The planner chooses decomposition breadth, capped at `MAX_SUBQUESTIONS` (default 5);
  the number of investigators running at once is an enforced guardrail `MAX_CONCURRENCY` (default 3–4),
  not LLM-controlled. Both env-configurable.
- **Alternatives:** Fully agentic concurrency; a single fixed number for both.
- **Rationale / trade-offs:** Separates a product decision (how broadly to investigate) from an
  operational safety limit (how hard to hit external APIs). Bounds protect OpenAI/Tavily rate + token
  limits, cost, single-node memory, and avoid diminishing synthesis returns.
- **Made by:** Human+Agent
- **Date:** 2026-06-09

### Idempotency vs result reuse: two distinct mechanisms
- **Decision:** (a) Invocation idempotency via a client-supplied action key reused across retries
  (Restate dedup, ~24h retention); (b) semantic result reuse via a normalized-question hash +
  `FRESHNESS_TTL` in session state; (c) deterministic per-step keys + OpenAI `Idempotency-Key` for the
  in-flight-at-crash window.
- **Alternatives:** Treating "same question text" as an idempotency match; relying only on `ctx.run`
  journaling.
- **Rationale / trade-offs:** Keeps "dedupe one intended action" separate from "reuse prior research"
  (which must be freshness-bounded). Avoids accidental collapse of legitimate re-asks, and avoids
  serving stale research.
- **Made by:** Human+Agent
- **Date:** 2026-06-09

### Metrics: store token counts by model only; simulate cost client-side
- **Decision:** The backend stores token counts (input/cached/output) by model + tool-call counts in an
  extensible `Metrics` object; dollar cost is computed in the CLI/UI from an editable price map.
- **Alternatives:** A server-side pricing table computing USD; an append-only usage ledger.
- **Rationale / trade-offs:** Tokens are stable facts; prices drift and belong where they can change.
  Keeps the service free of pricing logic and the stored data honest. A single aggregate object (merged
  by the single-writer turn handler from journaled inputs) is replay-safe without a ledger.
- **Made by:** Human+Agent
- **Date:** 2026-06-09

### Observability: minimal, layered traces
- **Decision:** Lean on the Restate UI journal first; add Tier-1 structured logs (`ctx.console`, stable
  step names) and a Tier-2 truncated per-turn `trace` exposed via `getTrace`. No custom visualizer in
  the service.
- **Alternatives:** A bespoke trace visualizer / full transcript persistence; nothing beyond the UI.
- **Rationale / trade-offs:** Enough to understand and demo the system without state bloat; a
  visualizer can be built externally from `getTrace` JSON (Mermaid/DOT/OTel) and is fully removable.
- **Made by:** Human+Agent
- **Date:** 2026-06-09

### Scope: in/out
- **Decision:** In scope — CLI client, cancellation/supersession, per-session cost/token tracking,
  Kubernetes deployment (local minikube only). Out of scope — web UI, `extract_image/pdf` tools, auth,
  external persistence, research-quality grading, multi-node Restate, remote/cloud Kubernetes.
- **Alternatives:** Building the full optional surface (web UI, multimodal tools, cloud deploy).
- **Rationale / trade-offs:** Concentrates effort on the durable multi-agent core and a credible local
  deploy; defers everything that adds cost/complexity without changing the architecture.
- **Made by:** Human+Agent
- **Date:** 2026-06-09

### Repository & secrets: public repo, generic framing, secrets out of history
- **Decision:** Public GitHub repo. API keys live only in a gitignored `.env` (`.env.example` ships
  placeholders); local-only input documents (e.g. PDFs) are gitignored. Docs are written as a generic,
  self-contained Restate multi-agent POC.
- **Alternatives:** Private repo; committing local inputs or keys.
- **Rationale / trade-offs:** Public history is permanent, so the first commit must be clean; generic,
  self-contained docs keep the repo usable as a standalone reference. Each runner supplies their own
  API keys locally.
- **Made by:** Human+Agent
- **Date:** 2026-06-09

### Build & test tooling: tsc + tsx + Vitest on ESM/NodeNext
- **Decision:** TypeScript compiled with `tsc` (build), run in dev with `tsx`, tested with Vitest;
  ESM + `NodeNext` module resolution; tests colocated as `*.test.ts` and excluded from the build.
- **Alternatives:** `ts-node` / `nodemon`, Jest, CommonJS.
- **Rationale / trade-offs:** `tsx` gives fast zero-config TS dev runs; Vitest is fast and ESM-native;
  `NodeNext` matches the Restate SDK's Node target. NodeNext requires `.js` extensions on relative
  imports in built source — accepted for standards alignment.
- **Made by:** Agent
- **Date:** 2026-06-09

### Phase 0 service shape: pure logic separated from the durable handler
- **Decision:** Keep pure functions (e.g. `composeGreeting`) in their own module, unit-tested directly;
  the Restate handler wraps them in `ctx.run`. Services live under `src/services/`.
- **Alternatives:** Put the logic inline in the handler.
- **Rationale / trade-offs:** Pure logic is testable without a running Restate server (fast CI), and the
  handler stays a thin durable wrapper — the pattern the agent loop reuses in later phases.
- **Made by:** Agent
- **Date:** 2026-06-09

### Model selection per role: cost-optimized, floating aliases
- **Decision:** Planner `gpt-5.4-nano`, investigator `gpt-5.4-mini`, synthesizer `gpt-5.4` (via
  `OPENAI_MODEL_PLANNER` / `_INVESTIGATOR` / `_SYNTHESIZER`), using floating aliases rather than dated
  snapshots.
- **Alternatives:** Balanced (`gpt-5.4-mini` / `gpt-5.4-mini` / `gpt-5.5`) and max-quality (`gpt-5.5` /
  `gpt-5.5` / `gpt-5.5-pro`) tiers; pinned dated snapshots; and special-purpose families — `*-codex`,
  `*-search-preview` / `gpt-5-search-api`, `*-deep-research`, `*-chat-latest` — all rejected as
  wrong-fit for hand-rolled tool-calling roles.
- **Rationale / trade-offs:** Cost-first for a POC. The planner is one structured call (nano suffices);
  investigators fan out in parallel multi-step ReAct loops, so `mini` keeps reliable function-calling at
  low cost (nano is risky for multi-tool loops); the synthesizer is the single quality-critical step, so
  full `gpt-5.4` sits above the investigator yet stays cheaper than `gpt-5.5` / `pro`. Aliases keep env
  churn low and auto-track the latest snapshot; we give up snapshot reproducibility — replay determinism
  is unaffected since Restate journals each call's output.
- **Made by:** Human+Agent
- **Date:** 2026-06-09

## Phase 1 — CI/CD & container

### Lint/format: Biome over ESLint + Prettier
- **Decision:** Use Biome 2.x as the single lint + format + import-organize tool; `biome ci` in CI, `biome check --write` locally.
- **Alternatives:** ESLint + Prettier (two tools plus plugins).
- **Rationale / trade-offs:** One fast binary, near-zero config, fewer moving parts for a focused POC. Less plugin breadth than ESLint, acceptable here.
- **Made by:** Human+Agent
- **Date:** 2026-06-09

### Secret scanning: gitleaks GitHub Action
- **Decision:** Run `gitleaks/gitleaks-action@v2` on push/PR; no `GITLEAKS_LICENSE` (not required for a personal-account repo).
- **Alternatives:** trufflehog; GitHub native secret scanning.
- **Rationale / trade-offs:** Simple, free for this account type; scans history + working tree and fails the build on findings.
- **Made by:** Agent
- **Date:** 2026-06-09

### Containerization: multi-stage Docker on node:22-slim, non-root
- **Decision:** Two-stage build (full deps + `tsc`, then prod-only deps + `dist`), run as the non-root `node` user, expose 9080.
- **Alternatives:** single-stage image; alpine base; distroless.
- **Rationale / trade-offs:** Smaller, cleaner runtime without dev deps/build tools; slim (glibc) avoids alpine/musl surprises. Distroless deferred (harder to debug for a POC).
- **Made by:** Agent
- **Date:** 2026-06-09

### CI triggers + Node version
- **Decision:** Run CI on `push` and `pull_request`; Node 22 with npm cache.
- **Alternatives:** push-only; a Node version matrix.
- **Rationale / trade-offs:** Covers direct pushes and PRs; a single Node version matches the dev/runtime target and keeps CI fast. Matrix deferred (one supported runtime for the POC).
- **Made by:** Agent
- **Date:** 2026-06-09

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

## Phase 2 — Session model & CLI

### Session lifecycle: client-generated id + `start`
- **Decision:** The CLI generates a UUID and calls `Session(id).start()`, which initializes state and echoes the id; `sendTurn` also auto-creates state on first call. The Session is a keyed virtual object.
- **Alternatives:** A separate factory service that generates and returns ids.
- **Rationale / trade-offs:** Fewer moving parts and naturally idempotent (the client owns the key); a factory is cleaner conceptually but adds a component. Easy to switch later.
- **Made by:** Human+Agent
- **Date:** 2026-06-09

### Turn interaction: one-way sendTurn + poll getProgress
- **Decision:** Clients invoke `sendTurn` one-way and poll the read-only shared `getProgress` until done, then read `getResult`.
- **Alternatives:** A blocking request-response that returns the final answer.
- **Rationale / trade-offs:** Matches a long-running, observable turn (NFR4): the exclusive `sendTurn` runs while shared reads stay concurrent; polling is simple and demo-friendly. SSE/streaming deferred.
- **Made by:** Human+Agent
- **Date:** 2026-06-09

### Mocked progress via durable ctx.sleep
- **Decision:** `sendTurn` advances each sub-question pending -> running -> done with `ctx.sleep(MOCK_STEP_MS)` between steps; the canned, cited answer comes from a pure `mockResearch` module.
- **Alternatives:** Resolve the whole turn instantly.
- **Rationale / trade-offs:** Durable sleeps make intermediate statuses observable and let the turn resume mid-flight after a restart (verified) — exercising FR1/NFR1/NFR4 before any real LLM. The pure mock stays unit-testable.
- **Made by:** Agent
- **Date:** 2026-06-09

### CLI: hand-rolled argv
- **Decision:** A small argv-based CLI (`start` / `turn` / `progress`) over `@restatedev/restate-sdk-clients`; no CLI framework dependency.
- **Alternatives:** commander / yargs.
- **Rationale / trade-offs:** Three subcommands don't justify a dependency and it is trivial to extend.
- **Made by:** Agent
- **Date:** 2026-06-09

## Phase 3 — Planner + synthesizer

### LLM access: Responses API + Zod structured outputs
- **Decision:** All model calls go through one durable wrapper (`callStructured`) using the OpenAI
  Responses API with Zod structured outputs (`responses.parse` + `zodTextFormat`), wrapped in
  `ctx.run`. `openai@6` + `zod@4` are compatible (the helper emits a draft-7 JSON schema for v4), so
  no workaround was needed.
- **Alternatives:** Chat Completions; free-text + manual JSON parsing.
- **Rationale / trade-offs:** Type-safe, replay-friendly, and treats model output strictly as data;
  one chokepoint to add idempotency keys / timeouts later (Phase 6). Slightly couples us to the
  Responses API request/response shape.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

### Citations resolved server-side from source ids
- **Decision:** The synthesizer returns `citedSourceIds` (e.g. `S1`), not URLs; we resolve them to
  the real `Source` objects and drop unknown ids.
- **Alternatives:** Let the model emit citation objects (title/url) directly.
- **Rationale / trade-offs:** Makes fabricated/injected citations impossible — every citation
  references a source we actually hold. Costs a tiny resolution step and a stable per-turn id scheme.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

### Prompts + schemas colocated per agent (sibling `*.prompt.ts`)
- **Decision:** Each agent's pure module (`planner.prompt.ts` / `synthesizer.prompt.ts`) holds its
  system text, input builder, Zod schema, and pure post-processing (`applyBreadthCap`,
  `resolveCitations`); the durable `*.ts` stays thin orchestration. `src/llm/` is generic transport
  only; the single shared helper is `asUntrustedBlock` in `format.ts`.
- **Alternatives:** A shared `src/llm/prompts.ts` + `schemas.ts`.
- **Rationale / trade-offs:** Each prompt has exactly one consumer, so colocation maximizes per-agent
  cohesion and keeps unit tests pure, while preserving the Phase 0 pure/durable file split. Prompts
  are no longer all in one place (accepted — they live beside their agent).
- **Made by:** Human+Agent
- **Date:** 2026-06-10

### Live LLM by default; Phase-2 mock removed
- **Decision:** `sendTurn` always runs the real planner/synthesizer; the `mockResearch` module is
  deleted. A missing `OPENAI_API_KEY` raises a `TerminalError` on the turn; `npm run check` needs no
  key (pure prompt/schema/stub unit tests cover CI).
- **Alternatives:** Keep a mock fallback toggled by env / key presence.
- **Rationale / trade-offs:** Keeps the "real LLM" story honest and the code branch-free; the
  trade-off is that live demos require a key (CI does not).
- **Made by:** Human+Agent
- **Date:** 2026-06-10

### Planner/synthesizer as in-handler durable steps
- **Decision:** For Phase 3 the planner and synthesizer are plain functions invoked from `sendTurn`
  (each one `ctx.run` step), not separate Restate Services; investigation is a stub.
- **Alternatives:** Stand up the orchestrator + investigator Services now.
- **Rationale / trade-offs:** Avoids premature abstraction; the orchestrator-worker fan-out and
  stateless investigator Services arrive in Phase 5 when real parallelism is needed. A sequential
  stub loop is enough until then.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

### Per-turn orchestrator extracted (refines "in-handler durable steps")
- **Decision:** The plan -> investigate -> synthesize flow lives in a per-turn orchestrator function
  (`runResearch`, [`src/agents/orchestrator.ts`](../src/agents/orchestrator.ts)) that reports progress
  via a small `ResearchHooks` interface; `sendTurn` only owns durable state and wires the hooks. This
  refines the entry above: the steps are still in-process (no new Restate Services), but the
  sequencing is no longer inline in the handler.
- **Alternatives:** Keep the flow inline in `sendTurn`; pass the mutable turn + `persist` into the
  orchestrator (less indirection, looser state boundary); a stateful `Orchestrator` class.
- **Rationale / trade-offs:** Separates "Session owns state" from "orchestrator owns flow" (cohesion),
  makes `sendTurn` read as state management, and creates the exact seam Phase 5 fills with bounded
  parallel fan-out. A function (not a class) avoids ceremony with no instance state; the hooks add one
  layer of inversion-of-control indirection. Stateless investigator Services and `RestatePromise.all`
  still arrive in Phase 5.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

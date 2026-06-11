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

### Planner defaults to investigate; `trivial` is a narrow exception
- **Decision:** Harden `PLANNER_SYSTEM` so the planner defaults to decomposition and only sets
  `trivial=true` under strict conditions (single self-contained definitional question, answerable
  from general knowledge, no person/company/product/statistic/current facts, high confidence). It
  explicitly disqualifies entity-specific and multi-topic ("X and Y", compare/vs) questions and adds
  an "if in doubt, trivial=false" tiebreaker.
- **Alternatives:** Remove the trivial branch entirely; add a server-side heuristic gate; switch the
  planner off the nano model.
- **Rationale / trade-offs:** A real research question ("Who is Daniel Takabayashi and what is Marvin
  AI") was intermittently classified `trivial`, short-circuiting investigation/synthesis. The trivial
  shortcut is still worth keeping for genuinely definitional asks, so we bias the prompt rather than
  drop the branch. Prompt-level mitigation is non-deterministic (especially on the nano planner
  model); a deterministic guard remains a possible follow-up.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

### Planner trivial/decompose anchored by few-shot examples (supersedes the above)
- **Decision:** Replace the abstract "default to investigate / if in doubt trivial=false" framing with
  a short balanced classifier plus concrete examples in both directions (e.g. "What does NRR stand
  for?" -> trivial; "Who is <person> and what is <product>?" -> investigate), and a tie-breaker that
  only leans to investigate when current/specific/source-backed facts are needed.
- **Alternatives:** Keep tightening adjectives in the rules; add a deterministic server-side gate;
  upgrade the planner model.
- **Rationale / trade-offs:** The previous hardening over-corrected — a genuinely definitional question
  ("What does NRR stand for?") triggered a full 5-search investigation. Few-shot examples give the small
  planner model pattern anchors for both classes, fixing the over-correction without reintroducing the
  false-trivial failure. Still probabilistic; the deterministic gate remains the fallback for a hard
  guarantee.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

## Phase 4 — Tools & investigator

### Sources derived from executed tools, not model claims
- **Decision:** The investigator returns free-text findings plus `sources` built from the URLs the
  tools actually retrieved (web_search results + fetched pages), de-duped and id-tagged; the
  synthesizer then selects which to cite.
- **Alternatives:** Have the investigator emit a structured `{ findings, citedSourceIds }` like the
  synthesizer.
- **Rationale / trade-offs:** Consistent with Phase 3's "citations from real sources" — a source can
  only exist if a tool returned it, so URLs cannot be fabricated. Slightly coarser (the investigator
  doesn't pre-select citations), which the synthesizer already handles.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

### Tooling: raw fetch for Tavily; `@mozilla/readability` + `linkedom` for page text
- **Decision:** `web_search` calls the Tavily REST API with raw `fetch` (no SDK); `fetch_page`
  extracts main-content text with `@mozilla/readability` over a `linkedom` DOM (body fallback),
  bounded + truncated.
- **Alternatives:** Tavily SDK; `readdown` (single-dep, LLM-Markdown); `html-to-text`; `jsdom`.
- **Rationale / trade-offs:** Matches the "raw SDK, minimal deps" stance and stays deterministic +
  unit-testable. `readdown` rejected as too new/unproven (v0.2.x, ~2 stars, github/jsr-only) for a
  public repo; `html-to-text` keeps nav/ad boilerplate; `linkedom` is lighter than `jsdom`.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

### Investigator owns its durable steps; deterministic ReAct loop
- **Decision:** The investigator is not wrapped in a single `ctx.run` (no nesting allowed); it issues
  a sequence of `ctx.run` steps with stable keys (`investigate:i:llm:n`, `investigate:i:tool:n:k`).
  `parallel_tool_calls: false` => one tool per turn. After `MAX_TOOL_TURNS` it makes one tool-free
  summary call (graceful degradation), and `fetch_page` reports HTTP failures to the model instead of
  throwing.
- **Alternatives:** A single mega-step; native parallel tool calls; failing the turn on any tool error.
- **Rationale / trade-offs:** Stable keys give crash-resume replay with no duplicate external calls
  (FR6/NFR3); one-tool-per-turn keeps the loop simple and deterministic; degradation keeps a flaky
  page from sinking the whole turn.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

### Source dedup by light-normalized URL; `registry.ts` naming
- **Decision:** `collectSources` de-dupes by a light-normalized URL (`normalizeUrl`: lowercase host,
  strip fragment/trailing slash, drop tracking params); the first-seen URL keeps its id `S{i+1}-{k}`
  (citation stability), a richer title upgrades a URL-fallback title, invalid URLs are dropped, and
  the list is capped at `MAX_SOURCES`. The tool dispatcher file is `registry.ts`, not `index.ts`.
- **Alternatives:** Raw-string URL equality; aggressive normalization (strip www, force https, sort
  query); a bare `index.ts` barrel.
- **Rationale / trade-offs:** Light normalization catches common dupes (trailing slash, utm) while
  keeping genuinely distinct pages (e.g. `?page=2`) distinct; aggressive normalization risks merging
  them. `registry.ts` names the responsibility (TOOL_DEFS + runTool) more clearly than `index.ts`.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

### Per-turn tool-call counts surfaced in state + CLI
- **Decision:** The `Turn` records `toolCalls: Record<string, number>` (e.g. `{ web_search: 2,
  fetch_page: 3 }`), aggregated across the turn's investigations via an `onToolCall` hook and printed
  by the CLI. Per-call detail (args/results) stays in the Restate journal.
- **Alternatives:** Nothing in state (journal only); a full per-turn `TraceEvent[]` now.
- **Rationale / trade-offs:** Cheap, replay-safe visibility into tool activity without state bloat; the
  full queryable trace (`getTrace`) remains a Phase 10 deliverable.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

## Phase 5 — Parallel investigation

### Investigators as a stateless service, fanned out with bounded concurrency
- **Decision:** The investigator is a stateless Restate service (`investigator.investigate`), invoked
  once per sub-question; the orchestrator fans them out concurrently in batches of `MAX_CONCURRENCY`
  (default 3) via `RestatePromise.all`, while the planner's `applyBreadthCap` keeps breadth <=
  `MAX_SUBQUESTIONS` (default 5). Both bounds are enforced server-side, never LLM-controlled.
- **Alternatives:** Run investigations in-process within the Session invocation; a streaming semaphore
  pool instead of batching; LLM-chosen concurrency.
- **Rationale / trade-offs:** A service per investigation gives each its own invocation/journal (true,
  observable parallelism) and fulfils the Phase-0 "stateless Service investigators" decision.   Batching
  is the pattern Restate documents and matches the TODO; the trade-offs are batch-granular progress (a
  batch flips to running together) and a barrier between batches, both fine at this scale. Server-side
  bounds protect OpenAI/Tavily rate limits and cost.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

## Phase 6 — Durability & crash-resume hardening

### Inactivity/abort timeouts on the Session object + Investigator service
- **Decision:** Set `inactivityTimeout` (default 300s, `RESTATE_INACTIVITY_TIMEOUT_MS`) and
  `abortTimeout` (default 60s, `RESTATE_ABORT_TIMEOUT_MS`) via the SDK `options` block on the
  `session` object and `investigator` service; env is read inline per file (matching the codebase's
  per-file env convention, no shared config module). The OpenAI client also sets a per-request
  `timeout` (`OPENAI_TIMEOUT_MS`, default 120s) kept below the inactivity timeout, and `maxRetries: 0`
  (`OPENAI_MAX_RETRIES`) so `ctx.run` is the single durable retry authority.
- **Alternatives:** Configure timeouts only at the Restate server level; a shared config module;
  per-handler overrides; keep the OpenAI SDK's default 2 in-process retries.
- **Rationale / trade-offs:** A long LLM `ctx.run` makes no journal progress while in flight, so the
  default 1-minute inactivity timeout would treat a multi-minute call as stuck and abort/retry it —
  the one change in this phase that prevents a real failure on long turns. Raising it above the
  longest expected call (with the OpenAI per-request timeout below it) lets a hung call fail fast and
  retry durably without Restate force-aborting a healthy one. SDK-level `options` keep the knob beside
  the code but are sent during discovery, so they require restate-server >= 1.4 (documented in the
  README). A shared module was rejected as disproportionate for two consumers reading two vars.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

### Scoped out (deferred): OpenAI `Idempotency-Key` + client action key
- **Decision:** Do **not** ship the deterministic OpenAI `Idempotency-Key` (per-step `ctx.rand` key)
  or the client action key on `sendTurn` (the `--turn-id` flag) in this phase; keep only the
  timeout/retry hardening above. Supersedes the originally-planned idempotency entries (which were
  drafted and verified working — a duplicate send returned `PreviouslyAccepted` — then reverted). This
  defers mechanisms (a) client action key and (c) OpenAI `Idempotency-Key` from the Phase-0
  "idempotency vs result reuse" decision; semantic result reuse (b) remains Phase 7.
- **Alternatives:** Implement both now, as the original Phase 6 plan specified.
- **Rationale / trade-offs:** Journal replay already makes crash-resume skip completed LLM/tool calls
  — that property holds from Phases 3-5. The OpenAI key only protects a millisecond window (a crash
  after the API returns but before its result is journaled), and the client action key only matters
  for a *retrying* client (the CLI mints a fresh turn id per send, so duplicates can't occur unless
  deliberately forced). For a learning POC the payoff did not justify the extra surface and the
  determinism reasoning (diminishing returns). Accepted gap: a single in-flight call could be
  re-issued on resume in that narrow window, and a deliberately-duplicated send would start a second
  turn — so NFR3 is now "completed steps never repeat (journal replay)" rather than a strict "never
  duplicate external effects". Cheap to add back later, since the wrapper is the single LLM chokepoint.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

## CLI refactor — presentation split + `util.parseArgs`

### CLI presentation extracted to `cli.output.ts`; argv parsed via `util.parseArgs`
- **Decision:** Move the CLI's pure formatting (`renderProgress`, `aggregateUsage`,
  `formatTurnResult`) into [`src/cli.output.ts`](../src/cli.output.ts) so [`src/cli.ts`](../src/cli.ts)
  keeps only routing + Restate IO, and parse argv with Node's built-in `node:util` `parseArgs`
  (`allowPositionals`, `strict: false`) instead of a hand-rolled `process.argv` switch.
- **Supersedes:** "CLI: hand-rolled argv" (Phase 2) — still no third-party CLI framework; `parseArgs`
  is a Node built-in, not a dependency.
- **Alternatives:** Keep all formatting inline in `cli.ts`; adopt commander/yargs.
- **Rationale / trade-offs:** Shrinks the entry file and makes the formatting unit-testable
  ([`src/cli.output.test.ts`](../src/cli.output.test.ts)) for the first time, with output strings
  unchanged. `strict: false` preserves the old lenient parsing, with the known edge case that a
  message token literally starting with `--` is read as a flag (irrelevant for quoted
  natural-language queries).
- **Made by:** Human+Agent
- **Date:** 2026-06-10

## Phase 7 — Refinement + result reuse

### Conversational refinement via a session journal (not a hash cache)
- **Decision:** Follow-up turns reuse prior work by feeding a *journal* of prior turns (their
  questions, key findings, and answers) to the planner and synthesizer. The planner is journal-aware:
  it emits only the NEW sub-questions still needed (0..MAX) and answers the rest from context (an empty
  list -> the synthesizer composes from the journal). Reuse reads from existing `turns` state; there is
  no separate sub-result cache. Entry stays a normal `turn` (no `refine` command).
- **Supersedes:** the planned "normalized-question-hash sub-result cache" and a later
  "explicit `reusePriorIds` catalog" draft (both in the Phase-7 plan history).
- **Alternatives:** the hash cache (opportunistic; couldn't resolve "go deeper on point 3" without
  prior context); an explicit `refine N` CLI command + reuse-id selection (more machinery, less
  natural).
- **Rationale / trade-offs:** the assignment frames refinement as conversational follow-ups over a
  prior answer, which needs the prior context in-hand — exactly what a journal provides — not text
  hashing. Trade-off: "only new sub-questions" leans on the (nano) planner; few-shot examples cover it
  and the planner model is the lever if it underperforms. A pure reuse-only answer may carry few fresh
  citations (a "go deeper" follow-up triggers new research, hence new sources).
- **Made by:** Human+Agent
- **Date:** 2026-06-10

### Context compaction via a rolling-summary compactor agent
- **Decision:** Bound the journal with a token budget: when its estimated size (`~chars/4` heuristic)
  exceeds `CONTEXT_MAX_TOKENS`, a durable compactor agent (`OPENAI_MODEL_COMPACTOR`, cheap) folds the
  oldest turns into a persisted rolling `summary` in one call, keeping the most recent
  `MAX_JOURNAL_TURNS` verbatim. The journal is then `summary + recent verbatim turns`. Stale turns
  (older than `FRESHNESS_TTL`) drop out and are re-researched. The CLI surfaces `Context: ~N / M tokens`
  and a `(compacting…)` indicator.
- **Alternatives:** a real tokenizer (`gpt-tokenizer`) for exact counts; hard-dropping oldest turns (no
  summary); an iterative fold-to-target loop (multiple compactor calls per turn).
- **Rationale / trade-offs:** an unbounded journal eventually blows the context window and cost; a
  rolling summary keeps the gist cheaply. The heuristic estimate is approximate (a tokenizer is a noted
  upgrade); a single fold-all-but-recent call keeps compaction to one durable step (deterministic,
  replays on resume) instead of a multi-call loop. The summary is not re-expired by `FRESHNESS_TTL`
  (TTL applies to verbatim turns) — accepted for the POC.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

## Phase 10 — Observability & hardening

### Tier-2 per-turn trace: assembled by the orchestrator, persisted by the Session
- **Decision:** Record an ordered, truncated `TraceEvent[]` per turn (`{ step, kind, detail, model?,
  tokens? }`), exposed via a `getTrace` shared handler and `npm run cli trace`. The investigator
  returns its own ordered trace fragment; the orchestrator brackets it with plan/investigate/synthesize
  events through a new `onTrace` hook; the Session appends + persists it (capped at `TRACE_MAX_EVENTS`)
  and emits the `compact` event. Token usage is duplicated between `usage[]` and trace `llm` events so
  the trace JSON is self-contained.
- **Alternatives:** derive the trace in the Session from the existing usage/tool-call hooks (loses the
  per-investigation index and tool-arg previews); a coarse one-event-per-investigation summary; logging
  the trace into the stream instead of storing it.
- **Rationale / trade-offs:** each component describes what it owns (investigator = its loop,
  orchestrator = the flow, Session = state); reuses the existing hook pattern (replay-safe, observable
  mid-turn); yields a faithful per-step transcript. The trace is queryable durable state, deliberately
  separate from the ephemeral log stream. Accepts a little token duplication for a self-contained JSON.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

### Investigator step names namespaced by sub-question index (supersedes `llm:<n>`)
- **Decision:** Investigator `ctx.run` steps are now `investigate:<i>:llm:<n>` /
  `investigate:<i>:tool:<n>:<k>` / `investigate:<i>:llm:final` (was `llm:<n>` / `tool:<n>:<k>`), so one
  stable name correlates logs, journal, and trace and stays globally unique once aggregated into a turn.
  Added a `tool` Tier-1 log line and `turn start|done|failed` lines. Supersedes the Phase-4 step-name
  convention.
- **Alternatives:** keep bare `llm:<n>` and disambiguate by invocation id only.
- **Rationale / trade-offs:** matches the form already documented in the LLM wrapper and the PRD's
  correlation goal; the invocation id alone correlated logs↔journal but not the aggregated per-turn
  usage/trace. No runtime cost.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

### Health: built-in liveness + an application readiness handler
- **Decision:** Rely on the SDK endpoint's built-in `GET :9080/health` (`200 OK`) for liveness, and add
  a small `health` service whose `check` handler reports dependency readiness as booleans
  (`openai`/`tavily` configured) with `status: ok|degraded` — never secret values. Pure
  `computeReadiness` is unit-tested.
- **Alternatives:** only document the built-in route; a separate bespoke HTTP health server; reporting
  key values.
- **Rationale / trade-offs:** liveness (process serving) and readiness (deps configured) answer
  different questions; the readiness handler is invokable/testable and feeds the Phase-11 Kubernetes
  probes, while booleans keep it secret-free.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

### Error handling: invalid tool arguments are terminal
- **Decision:** `runTool` validates model-supplied args with `safeParse` and throws `TerminalError` on
  failure, joining the existing terminal cases (bad JSON, unknown tool). Transient Tavily/network
  failures stay retryable; `fetch_page` still degrades gracefully.
- **Alternatives:** let the `ZodError` propagate (Restate then retries a permanently-doomed call); feed
  the validation error back to the model.
- **Rationale / trade-offs:** retrying a structurally-invalid call can never succeed and just burns the
  retry budget until abort; failing terminally is correct and matches "malformed input → terminal".
- **Made by:** Human+Agent
- **Date:** 2026-06-10

### Logging knob reconciled to `RESTATE_LOGGING` (dropped dead `LOG_LEVEL`)
- **Decision:** `.env.example` now documents `RESTATE_LOGGING` (the var the SDK's default logger
  actually reads) and drops the never-read `LOG_LEVEL`; added `TRACE_MAX_EVENTS`.
- **Alternatives:** wire `LOG_LEVEL` into a custom logger transport.
- **Rationale / trade-offs:** `LOG_LEVEL` was misleading dead config; pointing at the real SDK var is
  simpler than a custom transport for a POC. `DEBUG` surfaces the truncated LLM-output previews.
- **Made by:** Human+Agent
- **Date:** 2026-06-10

## Phase 11 — Local Kubernetes (minikube) deployment

### Deploy via the Restate Operator (not the bare Helm chart)
- **Decision:** Deploy on minikube using the **Restate Operator** with a `RestateCluster`
  (single-node StatefulSet + PVC) and a `RestateDeployment` for the service; the operator
  auto-registers the service and manages versioning/draining. Manifests in [`k8s/`](../k8s/).
- **Alternatives:** the bare Restate Helm chart + a plain `Deployment`/`Service` + manual
  `restate deployments register` (Approach A, drafted in the Phase 11 plan history).
- **Rationale / trade-offs:** version-draining (keep the old service version alive until its
  in-flight invocations finish) is the strongest, on-theme demonstration of the durability thesis
  — redeploy mid-research with zero dropped/duplicated work — and removes the manual registration
  step. Costs a cluster-scoped operator + 3 CRDs and the cluster-owns-a-namespace model;
  "recommended" is aimed at real clusters, accepted here for the demo value. The Helm-chart
  approach remains a documented fallback.
- **Made by:** Human+Agent
- **Date:** 2026-06-11

### NetworkPolicies off locally; keys via Secret + config via ConfigMap; single namespace
- **Decision:** Set `spec.security.disableNetworkPolicies: true` on the `RestateCluster` for local
  minikube; inject the two API keys via a `durable-research-secrets` Secret built from `.env` (never
  in the image) and non-secret tuning via a `durable-research-config` ConfigMap, both consumed with
  `envFrom`; run the cluster and the app in a single `restate` namespace; load the image with
  `minikube image load` + `imagePullPolicy: IfNotPresent`.
- **Alternatives:** enforce NetworkPolicies locally (needs a policy CNI like Calico + an
  `allow.restate.dev/<name>` namespace label); one combined Secret for all config; a separate app
  namespace registering cross-namespace; a remote registry pull.
- **Rationale / trade-offs:** minikube's default CNI doesn't enforce NetworkPolicy, so disabling
  makes behavior explicit and CNI-independent (matches Restate's official local guide); the
  Secret/ConfigMap split keeps secrets out of git and config reviewable; a single namespace mirrors
  the tested guide and avoids cross-namespace/ordering surprises. Production posture (policies on,
  app in a labelled namespace) is deferred.
- **Made by:** Human+Agent
- **Date:** 2026-06-11

### Operator-aware runbooks + realigned troubleshooting guide
- **Decision:** Ship [`docs/runbooks.md`](./runbooks.md) (deploy, roll out + roll back, recover a
  stuck invocation, rotate keys, resume after pod loss, teardown) and realign
  [`docs/k8s-troubleshooting.md`](./k8s-troubleshooting.md) to the Operator topology/naming, curated
  to a top 10.
- **Supersedes:** the earlier `docs/k8s-troubleshooting.md` written for the Helm /
  manual-registration approach (old `research-poc` naming, default namespace).
- **Alternatives:** keep the Approach-A guide as-is and add a separate operator guide.
- **Rationale / trade-offs:** one guide matching the shipped approach is less confusing than two;
  the reusable command cheat sheet + 30-second triage loop were preserved.
- **Made by:** Human+Agent
- **Date:** 2026-06-11

## Phase 12 — Design note, README & final polish

### Design note in the README; Phases 8 & 9 recorded as future work
- **Decision:** Put the design write-up (agent topology + which Restate primitive delivers which
  property + trade-offs + status/future-work) directly in the README rather than a separate document,
  and wrap up the POC with **Phase 8 (cancellation/supersession + metrics)** and **Phase 9 (broader
  automated test suite)** explicitly deferred as future work. Phase 11's live-minikube validation and
  the fresh-clone repro pass remain pending (tracked, not yet ticked).
- **Alternatives:** a standalone `docs/design.md`; building Phase 8 and 9 before wrapping up.
- **Rationale / trade-offs:** for a POC the README is the single entry point a reviewer reads, so the
  design note belongs there beside setup/run/deploy. Deferring 8/9 keeps the wrap-up honest (the note
  describes what is actually built and clearly lists what isn't) and was a deliberate, time-boxed
  scope call. Cost: the repo is "wrapped up" without cancellation, metrics, or an integration-test
  suite — all cheap to add later behind the existing seams (the LLM wrapper, the orchestrator hooks,
  and the single-writer turn handler).
- **Made by:** Human+Agent
- **Date:** 2026-06-11

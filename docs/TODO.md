# Implementation TODO — Durable Multi-Agent Research

Incremental build plan derived from [`docs/requirements.md`](./requirements.md). Each phase is small,
independently verifiable, and ends in a runnable state.

**Conventions**
- `[ ]` = not started, `[x]` = done.
- Every phase carries Security and Docs tasks plus an explicit Acceptance criteria block.
- Do one phase at a time; don't start the next until acceptance criteria pass.
- Notation: `FR#` / `NFR#` refer to the functional / non-functional requirements in the PRD.

---

## Phase 0 — Project skeleton & durable "hello"

> Goal: a runnable TypeScript + Restate service with one durable handler and a passing test.

- [x] Initialize the TS project (`package.json`, `tsconfig.json`, strict mode, `src/` layout).
- [x] Add `@restatedev/restate-sdk`; create a trivial durable handler (e.g. `greet` that does one `ctx.run` step).
- [x] Add an `npm run dev` script and document running `restate-server` + registering the deployment.
- [x] Add a minimal unit test (so CI has something to run) and a test runner (Vitest).
- [x] **Security:** add `.gitignore` and `.env.example`; confirm no secrets are committed.
- [x] **Docs:** README "quick start" (install, run server, register, call the handler).

**Acceptance criteria**
- [x] `npm run build` and `npm test` pass.
- [x] With `restate-server` running and the deployment registered, calling `greet` returns a result.
- [x] `git status` shows no `.env` or other secrets staged.

## Phase 1 — CI/CD & container

> Goal: every push is linted, type-checked, built, tested, and scanned; the service is containerized.

- [x] GitHub Actions workflow: install, typecheck, lint, build, test.
- [x] Add a secret-scanning step (e.g. gitleaks) to the workflow.
- [x] Add a `Dockerfile` that builds and runs the service; verify it builds in CI.
- [x] Add lint/format config (ESLint + Prettier or Biome).
- [x] **Security:** secret-scan runs on every PR; document how to rotate keys.
- [x] **Docs:** README "CI" + "build the container" sections.

**Acceptance criteria**
- [x] CI is green on a clean checkout.
- [x] `docker build` succeeds and the container starts the service.
- [x] The secret-scan step fails the build if a fake secret is introduced (spot-checked).

## Phase 2 — Session model + CLI (mocked turns)

> Goal: durable multi-turn sessions with observable progress, using mocked answers and a CLI.

- [x] Implement the Session Virtual Object: `startSession`, `sendTurn`, and a `getProgress` shared (read-only) handler. (FR1, NFR2, NFR4)
- [x] Model session state: turn history, per-turn status, sub-question list (mocked).
- [x] Return a canned, cited answer from recorded fixtures for the canonical query.
- [x] Build the CLI (`@restatedev/restate-sdk-clients`): start session, send turn, poll progress.
- [x] **Security:** validate/normalize CLI input; reject malformed turns with a terminal error.
- [x] **Docs:** README "drive it with the CLI"; document the fixtures in `docs/examples.md`.

**Acceptance criteria**
- [x] Two sessions run concurrently without their state interfering (NFR2).
- [x] `getProgress` reflects mocked sub-question statuses during a turn.
- [x] State survives a server restart (start a session, restart, session still resolves).

## Phase 3 — Planner + synthesizer (real LLM, stubbed investigation)

> Goal: real decomposition and cited synthesis; investigator results still stubbed.

- [x] Add an LLM wrapper around the `openai` SDK that runs inside `ctx.run`, **returns token usage (incl. model)**, and emits Tier-1 structured logs with stable step names. (FR2)
- [x] Planner: decompose a question into sub-questions (bounded breadth), or answer immediately for trivial questions. (FR2)
- [x] Synthesizer: combine stubbed sub-results into a structured answer with citations. (FR4)
- [x] Disable native parallel tool-calls; set deterministic step naming conventions.
- [x] **Security:** treat model output as data; never log secrets; truncate logged prompts/responses.
- [x] **Docs:** document the planner/synthesizer prompts and the LLM-wrapper contract.

**Acceptance criteria**
- [x] A complex question produces a sensible list of sub-questions; a trivial one is answered directly.
- [x] The synthesized answer includes citations referencing the (stubbed) sources.
- [x] Each LLM step appears once in the journal and carries token usage.

## Phase 4 — Tools: `web_search` + `fetch_page`

> Goal: real, durable, idempotent tools and a single end-to-end real investigator. (FR6)

- [x] Implement `web_search` (Tavily) and `fetch_page` as `ctx.run` durable steps with stable keys.
- [x] Implement an investigator ReAct loop (LLM ↔ tools) for one sub-question, producing a cited sub-result. (FR6)
- [x] Bound + truncate tool outputs before feeding them back to the model.
- [x] **Security:** treat fetched content as untrusted data (no instruction-following); cap sizes.
- [x] **Docs:** document the tool contracts and the investigator loop.

**Acceptance criteria**
- [x] A single sub-question is investigated end-to-end against live Tavily + page fetches.
- [x] Re-running a completed tool step replays the journaled result (no second external call).
- [x] Sub-results carry source URLs used for citations.

## Phase 5 — Parallel investigation + bounded concurrency

> Goal: orchestrator fans out investigators concurrently, within a bound. (FR3, NFR5)

- [x] Wire planner → parallel investigators → synthesizer (orchestrator-worker topology). (FR3)
- [x] Run investigators via `RestatePromise.all`, batched at `MAX_CONCURRENCY`. (NFR5)
- [x] Enforce agentic breadth cap `MAX_SUBQUESTIONS`; aggregate sub-results for synthesis.
- [x] **Security:** ensure bounds are enforced server-side (not LLM-controlled) to cap rate/cost.
- [x] **Docs:** document the two concurrency knobs and the rationale for the defaults.

**Acceptance criteria**
- [x] A multi-part question runs several investigators concurrently (visible in the journal/logs).
- [x] No more than `MAX_CONCURRENCY` investigators run at once; breadth never exceeds `MAX_SUBQUESTIONS`.
- [x] The canonical query (Datadog vs Snowflake) returns a synthesized, cited answer.

## Phase 6 — Durability & crash-resume hardening

> Goal: prove resume-without-repeat and idempotent external effects. (NFR1, NFR3)

- [ ] Client action-key idempotency on `sendTurn`; deterministic per-step keys via `ctx.rand`.
- [ ] Pass the OpenAI `Idempotency-Key` for the in-flight-at-crash window.
- [ ] Configure inactivity/abort timeouts for long LLM calls.
- [ ] **Security:** verify retries/resumes never duplicate external effects (NFR3).
- [ ] **Docs:** document the durability story and the kill/restart procedure.

**Acceptance criteria**
- [ ] Killing the server mid-research and restarting resumes the turn to completion.
- [ ] No completed LLM call or web search is repeated on resume (verified in journal/logs).
- [ ] A duplicate `sendTurn` with the same idempotency key does not start a second turn.

## Phase 7 — Refinement + result reuse

> Goal: "go deeper on point N" reuses relevant prior work instead of restarting. (FR5)

- [ ] Store prior sub-results keyed by a normalized question hash with timestamps in session state.
- [ ] On refinement, reuse fresh prior sub-results (within `FRESHNESS_TTL`) and investigate only the deeper angle; otherwise refresh. (FR5)
- [ ] Surface "what was reused vs redone" in the turn result.
- [ ] **Security:** bound reuse lookups; expire stale entries to avoid serving outdated research.
- [ ] **Docs:** document the reuse/freshness model and how it differs from idempotency.

**Acceptance criteria**
- [ ] A refinement turn reuses prior sub-results (observable: fewer new LLM/tool calls).
- [ ] Stale prior work (beyond `FRESHNESS_TTL`) triggers a refresh.
- [ ] The result distinguishes reused vs newly-computed parts.

## Phase 8 — Cancellation/supersession + metrics

> Goal: handle contradicting turns and expose per-session token/tool metrics.

- [ ] Cancellation/supersession: a superseding turn cancels the in-flight invocation and marks the prior turn superseded.
- [ ] Implement the `Metrics` object (tokens by model + tool-call counts) merged by the turn handler.
- [ ] Add a `getMetrics` shared handler; CLI prints metrics per turn (and "tokens saved by reuse").
- [ ] **Security:** ensure cancellation runs compensations/cleanup without leaving partial effects.
- [ ] **Docs:** document cancellation semantics and the metrics shape (cost simulated client-side).

**Acceptance criteria**
- [ ] A superseding turn stops the in-flight turn promptly; state reflects supersession.
- [ ] `getMetrics` returns per-model token counts and tool-call counts for the session.
- [ ] Metrics are not double-counted across a crash/resume.

## Phase 9 — Automated tests

> Goal: unit + integration coverage across representative queries and edge cases.

- [ ] Unit tests: planner decomposition, synthesizer citations, tool wrappers, metrics merge, reuse/freshness logic.
- [ ] Integration tests with `@restatedev/restate-sdk-testcontainers` across the demo query set (Q1–Q6), including the immediate-answer and refinement branches.
- [ ] Edge cases: malformed input, tool failure/degradation, supersession, duplicate idempotency key.
- [ ] **Security:** a test asserting fetched content cannot inject instructions; a secret-scan smoke test.
- [ ] **Docs:** README "running the tests".

**Acceptance criteria**
- [ ] `npm test` runs unit + integration suites green locally and in CI.
- [ ] A crash/resume integration test asserts no repeated completed steps.
- [ ] Edge-case tests pass (degradation, supersession, dedup).

## Phase 10 — Observability & hardening

> Goal: structured per-turn traces and operational robustness.

- [ ] Tier-2 per-turn `trace` (truncated `TraceEvent[]`) + a `getTrace` shared handler.
- [ ] Apply step-naming conventions consistently across logs, journal, and trace.
- [ ] Health check; consistent error handling (terminal vs retryable); structured logging polish.
- [ ] **Security:** confirm traces/logs are truncated and secret-free.
- [ ] **Docs:** README "observability" + a Restate UI walkthrough of a tool-call lifecycle.

**Acceptance criteria**
- [ ] `getTrace` returns a readable transcript of a turn's LLM/tool steps.
- [ ] Logs, journal, and trace correlate via consistent IDs and step names.
- [ ] A health endpoint/handler reports service readiness.

## Phase 11 — Local Kubernetes (minikube) deployment

> Goal: run the whole system on local minikube and demonstrate in-cluster resume.

- [ ] Build the service image and load it into minikube (`minikube image load`).
- [ ] Deploy Restate via its Helm chart (single-node `StatefulSet` + default `standard` PVC).
- [ ] Deploy the service `Deployment` + `Service`; register the deployment with Restate.
- [ ] Demonstrate pod-kill resume locally (service pod and/or Restate pod; PVC persists state).
- [ ] **Security:** keys provided via a Kubernetes `Secret` (from `.env`), never baked into the image.
- [ ] **Docs:** README "deploy on minikube" with exact commands.

**Acceptance criteria**
- [ ] `kubectl get pods` shows Restate + the service running on minikube.
- [ ] A research turn completes end-to-end through the in-cluster Restate ingress.
- [ ] Deleting the service pod mid-research resumes the turn after the pod restarts.

## Phase 12 — Design note, README & final polish

> Goal: a clear design write-up and a clean, reproducible repository.

- [ ] Design note (in the README): agent topology and why; which Restate primitives solve which property; trade-offs and future-work.
- [ ] README end-to-end: setup, run, CLI demo (canonical query), durability demo, minikube.
- [ ] Final repro pass: fresh-clone smoke test of the documented commands.
- [ ] **Security:** final secret-scan + manual review of committed files before tagging.
- [ ] **Docs:** ensure `docs/decisions.md` reflects all decisions to date.

**Acceptance criteria**
- [ ] A new reader can set up and run the demo from the README alone.
- [ ] The design note explains topology, primitives→properties, and trade-offs.
- [ ] No secrets or out-of-scope artifacts are present in the repository.

---

## Out of scope (tracked, not built — see PRD)
- [ ] Minimal web UI.
- [ ] `extract_image_content` / `extract_pdf_content` tools.
- [ ] Authentication / authorization.
- [ ] External persistence (Postgres/Redis/etc.).
- [ ] Research-quality grading/evaluation.
- [ ] Multi-node Restate cluster.
- [ ] Remote / cloud Kubernetes.

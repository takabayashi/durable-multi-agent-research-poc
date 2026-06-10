# Traceability — requirement → PRD → TODO phase

This maps every product requirement to where it is specified ([`docs/requirements.md`](./requirements.md))
and where it is built ([`docs/TODO.md`](./TODO.md)), to prove coverage. `FR#` = functional,
`NFR#` = non-functional, plus cross-cutting capabilities and deliverables.

## Functional requirements

| Requirement | PRD section | TODO phase |
|-------------|-------------|------------|
| FR1 — Multi-turn sessions; state persists across turns and restarts | Core Features; User Flows 1–2; Technical Constraints (state) | Phase 2 (model + persistence), reinforced Phase 6 |
| FR2 — Decomposition: planner breaks a question into sub-questions | Core Features; User Flow 6 | Phase 3 |
| FR3 — Parallel investigation (concurrent, not sequential) | Core Features; User Flow 6 | Phase 5 |
| FR4 — Synthesis with citations | Core Features; User Flow 2 | Phase 3 (synthesis), Phase 4–5 (real citations) |
| FR5 — Refinement reusing relevant prior work | Core Features; User Flow 4 | Phase 7 |
| FR6 — Tools: `web_search` (Tavily) + `fetch_page` | Core Features; Tech Stack | Phase 4 |
| FR7 — Optional tools: `extract_image_content` / `extract_pdf_content` | Out of Scope | Out of scope (tracked) |

## Non-functional requirements

| Requirement | PRD section | TODO phase |
|-------------|-------------|------------|
| NFR1 — Durable progress: resume without re-issuing completed LLM/tool calls | Problem Statement; Success Metrics | Phase 6 (proof), foundation in Phases 3–5 |
| NFR2 — Per-session state isolation | Target Users; Technical Constraints | Phase 2 |
| NFR3 — Idempotent external effects | Error Handling; Security | Phase 6 |
| NFR4 — Observable progress (subagents + status) | Core Features; User Flow 3 | Phase 2 (getProgress), Phase 10 (trace/getTrace) |
| NFR5 — Bounded concurrency (with rationale) | Technical Constraints | Phase 5 |

## Cross-cutting capabilities & deliverables

| Item | PRD section | TODO phase |
|------|-------------|------------|
| Start a session (returns session ID, resumable) | Core Features; User Flow 1 | Phase 2 |
| Send a turn (new question / refinement / follow-up) | Core Features; User Flows 2 & 4 | Phase 2 (mock) → Phase 3–5 (real) |
| Resume after failure (kill mid-research, restart) | User Flow 5; Success Metrics | Phase 6 |
| Token / cost tracking per session | Core Features | Phase 8 |
| Cancellation / supersession of in-flight turns | Core Features; Error Handling | Phase 8 |
| CLI client to drive the system | Target Users; Technical Constraints | Phase 2 |
| Observability (logs, journal, traces) | Security; Success Metrics | Phase 3 (logs) → Phase 10 (trace) |
| Secrets handling / public-repo hygiene | Security | Phase 0–1 (gitignore, secret-scan) |
| CI/CD pipeline | Tech Stack | Phase 1 |
| Containerization | Tech Stack | Phase 1 |
| Kubernetes deployment (local minikube) | Technical Constraints | Phase 11 |
| Automated tests | Tech Stack; Success Metrics | Phase 9 |
| Design note (topology, primitives, trade-offs) | (README deliverable) | Phase 12 |
| README / one-command run | Technical Constraints; Success Metrics | Phase 0 → Phase 12 |

## Gaps / partially covered (deliberate)

- **FR7 optional multimodal tools** — not built; `web_search` + `fetch_page` cover the core flow. Easy
  to add later as additional `ctx.run` tools.
- **Synthesis citations** evolve across phases: stubbed in Phase 3, then backed by real sources from
  Phase 4–5. Early phases show the shape, not final fidelity.
- **Cost figures** — the backend stores token counts + model only; dollar cost is simulated
  client-side (intentional, see decisions). No server-side pricing.
- **Live per-subagent metrics** — investigators are stateless Services, so per-subagent live detail
  comes from the Restate UI; a structured per-subagent API would require promoting investigators to
  Virtual Objects (noted upgrade, not built).
- **Authentication / authorization** — out of scope; required before any non-local exposure.
- **Remote/cloud Kubernetes & multi-node Restate** — out of scope; deployment is demonstrated on local
  minikube with a single Restate node.
- **Research-quality evaluation** — out of scope by design; the focus is the system, not answer
  correctness.

# Architecture

A visual map of the durable multi-agent research assistant, derived directly from the `src/` tree and
the `k8s/` manifests. GitHub renders the Mermaid blocks below inline — no setup needed.

> There is also a richer, interactive version with a dark/light theme toggle in
> [`architecture.html`](architecture.html) in this folder (open it locally in a browser).

For the narrative design note (agent topology, Restate primitives → properties, trade-offs), see the
[README](../README.md#design-note); the decision log is in [`decisions.md`](./decisions.md).

## Contents

1. [Project file structure](#1-project-file-structure)
2. [System layers overview](#2-system-layers-overview)
3. [Research turn flow](#3-research-turn-flow)
4. [Investigator ReAct loop](#4-investigator-react-loop)
5. [Fan-out and concurrency](#5-fan-out-and-concurrency)
6. [Provider abstraction](#6-provider-abstraction)
7. [Domain model](#7-domain-model)
8. [Session lifecycle](#8-session-lifecycle)
9. [Conversation journal and compaction](#9-conversation-journal-and-compaction)
10. [Durability and crash-resume](#10-durability-and-crash-resume)
11. [Observability](#11-observability)
12. [Handler and endpoint map](#12-handler-and-endpoint-map)
13. [End-to-end user journey](#13-end-to-end-user-journey)
14. [Kubernetes deployment](#14-kubernetes-deployment)

> **Legend.** Indigo = durable / stateful; teal = stateless compute; purple = external provider.

---

## 1. Project file structure

How the `src/` tree is organised — entry points, agents, the LLM transport layer, durable tools,
services, and the session state object.

```mermaid
flowchart LR
  root["durable-multi-agent-research-poc"]
  root --> src["src/"]
  root --> docs["docs/ — PRD, decisions, runbooks"]
  root --> k8s["k8s/ — Operator manifests"]
  root --> infra["Dockerfile · CI · biome · tsconfig"]

  src --> app["app.ts — endpoint entry :9080"]
  src --> cli["cli.ts · cli.output.ts"]
  src --> agents["agents/"]
  src --> llm["llm/"]
  src --> tools["tools/"]
  src --> services["services/"]
  src --> session["session/"]

  agents --> ag1["orchestrator.ts"]
  agents --> ag2["planner.ts"]
  agents --> ag3["investigator.ts"]
  agents --> ag4["synthesizer.ts"]
  agents --> ag5["compactor.ts"]
  agents --> ag6["journal.ts — pure"]

  llm --> l1["client.ts — lazy OpenAI"]
  llm --> l2["wrapper.ts — callStructured / callTools"]
  llm --> l3["format.ts — untrusted-data block"]

  tools --> t1["search.ts — web_search"]
  tools --> t2["fetch.ts — fetch_page"]
  tools --> t3["registry.ts — dispatch"]
  tools --> t4["url.ts — dedup"]

  services --> s1["health.ts"]
  services --> s2["greeter.ts"]

  session --> se1["session.ts — Virtual Object"]
  session --> se2["types.ts — domain model"]

  class root,session,se1 durable;
  class agents,ag1,ag2,ag3,ag4,ag5,ag6,llm,l1,l2,l3,tools,t1,t2,t3,t4,cli,services,s1,s2 compute;
  classDef durable fill:#312e81,stroke:#6366f1,color:#fff;
  classDef compute fill:#0e7490,stroke:#22d3ee,color:#fff;
```

## 2. System layers overview

From the CLI down to external providers. The Restate server sits in front as ingress + durable
journal; every agent call eventually reaches OpenAI or Tavily.

```mermaid
flowchart TB
  subgraph client_layer["Client layer"]
    cli["CLI — start · turn · progress · trace · health"]
    http["HTTP client / curl"]
  end
  subgraph durable_layer["Durable execution — Restate server"]
    ingress["Ingress :8080"]
    journal[("Durable journal + state")]
    adminui["Admin / UI :9070"]
  end
  subgraph svc_layer["Service endpoint :9080 — this app"]
    session["session — Virtual Object"]
    investigator["investigator — Service"]
    health["health — Service"]
    greeter["greeter — Service"]
  end
  subgraph agent_layer["Agent / domain logic"]
    orchestrator["orchestrator — runResearch"]
    planner["planner"]
    synthesizer["synthesizer"]
    compactor["compactor"]
  end
  subgraph provider_layer["External providers"]
    openai["OpenAI Responses API"]
    tavily["Tavily Search API"]
    web["Web pages"]
  end

  cli --> ingress
  http --> ingress
  ingress --> session
  ingress --> investigator
  ingress --> health
  ingress --> greeter
  session <--> journal
  investigator <--> journal
  session --> orchestrator
  orchestrator --> planner
  orchestrator --> investigator
  orchestrator --> synthesizer
  session --> compactor
  planner --> openai
  synthesizer --> openai
  compactor --> openai
  investigator --> openai
  investigator --> tavily
  investigator --> web

  class session,journal,adminui durable;
  class orchestrator,planner,synthesizer,compactor,investigator,health,greeter,cli,http,ingress compute;
  class openai,tavily,web external;
  classDef durable fill:#312e81,stroke:#6366f1,color:#fff;
  classDef compute fill:#0e7490,stroke:#22d3ee,color:#fff;
  classDef external fill:#6b21a8,stroke:#a855f7,color:#fff;
```

## 3. Research turn flow

The orchestrator–worker sequence behind one `sendTurn`: the planner decomposes, investigators fan out
concurrently, the synthesizer writes a cited answer. The CLI polls progress out-of-band.

```mermaid
sequenceDiagram
  autonumber
  actor U as CLI user
  participant R as Restate ingress
  participant S as session VO
  participant O as orchestrator
  participant P as planner LLM
  participant I as investigators xN
  participant Y as synthesizer LLM

  U->>R: sendTurn(message, turnId) [fire-and-forget]
  R->>S: invoke sendTurn (single writer)
  S->>S: persist turn + build journal
  S->>O: runResearch(message, hooks, journal)
  O->>P: plan(question, journal)
  P-->>O: trivial? OR new sub-questions
  alt trivial message
    O-->>S: direct answer, no citations
  else needs research
    O->>I: investigate(subQ) batched at MAX_CONCURRENCY
    I-->>O: findings + sources + usage + trace
    O->>Y: synthesize(question, subResults, journal)
    Y-->>O: answer + citedSourceIds
  end
  O-->>S: Answer
  S->>S: status = done, persist
  loop poll until done
    U->>R: getProgress / getResult(turnId)
    R->>S: shared read-only handler
    S-->>U: progress, then cited answer
  end
```

## 4. Investigator ReAct loop

Each investigator is a stateless Service running a bounded ReAct loop. Every LLM turn and every tool
call is its own `ctx.run` step, so completed steps replay on resume — no duplicate external calls.

```mermaid
flowchart TB
  start(["investigate(subQuestion, index)"]) --> seed["seed conversation: system + SUB-QUESTION"]
  seed --> loop{"turn < MAX_TOOL_TURNS ?"}
  loop -- no --> degrade["final LLM call: summarize, no tools"]
  loop -- yes --> llm["callTools — ctx.run(investigate:i:llm:n)"]
  llm --> calls{"tool calls requested ?"}
  calls -- no --> done["findings = assistant text"]
  calls -- yes --> exec["per call: ctx.run(investigate:i:tool:n:k) runTool"]
  exec --> tool{"which tool ?"}
  tool -- web_search --> tav["Tavily — titles, urls, snippets"]
  tool -- fetch_page --> fp["fetch + Readability — bounded text"]
  tav --> feed["append function_call_output as untrusted data"]
  fp --> feed
  feed --> loop
  degrade --> out
  done --> out(["SubResult: findings + collectSources()"])

  class start,out,exec,llm,degrade durable;
  class tav,fp external;
  classDef durable fill:#312e81,stroke:#6366f1,color:#fff;
  classDef external fill:#6b21a8,stroke:#a855f7,color:#fff;
```

## 5. Fan-out and concurrency

Planner breadth is capped server-side at `MAX_SUBQUESTIONS`; investigators run via `RestatePromise.all`
in batches of `MAX_CONCURRENCY`. Bounds are enforced by us, never by the model — they cap rate and cost.

```mermaid
flowchart TB
  plan["planner -> subQuestions[]"] --> cap["applyBreadthCap — MAX_SUBQUESTIONS = 5"]
  cap --> batch["chunk() into batches of MAX_CONCURRENCY = 3"]
  batch --> b1["Batch 1"]
  batch --> b2["Batch 2 ..."]
  b1 --> p1["RestatePromise.all"]
  p1 --> i0["investigate:0"]
  p1 --> i1["investigate:1"]
  p1 --> i2["investigate:2"]
  i0 --> agg["aggregate SubResults, usage, toolCalls, trace"]
  i1 --> agg
  i2 --> agg
  b2 --> p2["RestatePromise.all — next batch"]
  p2 --> agg
  agg --> synth["synthesize(subResults, journal)"]

  class i0,i1,i2,p1,p2 compute;
  class plan,synth durable;
  classDef durable fill:#312e81,stroke:#6366f1,color:#fff;
  classDef compute fill:#0e7490,stroke:#22d3ee,color:#fff;
```

## 6. Provider abstraction

Every model call funnels through one durable entry point. `callStructured` (Zod-typed JSON) and
`callTools` (ReAct) both wrap `ctx.run`; `getOpenAI` is a lazy singleton with retries delegated to
Restate. The tool registry validates model arguments before dispatching.

```mermaid
classDiagram
  class callStructured {
    +ctx.run(step)
    +responses.parse(schema)
    +parallel_tool_calls = false
    +returns data + TokenUsage
  }
  class callTools {
    +ctx.run(step)
    +responses.create(tools)
    +returns outputItems + functionCalls + TokenUsage
  }
  class getOpenAI {
    +lazy singleton
    +maxRetries = 0
    +per-request timeout
  }
  class PromptBuilders {
    +plannerInput()
    +investigatorInput()
    +synthesizerInput()
    +compactorInput()
    +asUntrustedBlock()
  }
  callStructured --> getOpenAI
  callTools --> getOpenAI
  callStructured ..> PromptBuilders
  callTools ..> PromptBuilders
```

```mermaid
flowchart LR
  model["LLM function call"] --> runTool["runTool(name, argsJson)"]
  runTool --> v{"valid JSON + args ?"}
  v -- no --> terr["TerminalError — no retry"]
  v -- yes --> sw{"tool name"}
  sw -- web_search --> ws["webSearch -> Tavily"]
  sw -- fetch_page --> fpp["fetchPage -> Readability + linkedom"]
  ws --> outp["outputForModel + found[]"]
  fpp --> outp
  outp --> cs["collectSources -> stable Source ids Sn-k"]

  class ws,fpp external;
  classDef external fill:#6b21a8,stroke:#a855f7,color:#fff;
```

## 7. Domain model

The durable shapes persisted on the session (`src/session/types.ts`). A `Turn` aggregates
sub-questions, an answer, token usage, tool counts, a context snapshot, and a Tier-2 trace.

```mermaid
classDiagram
  class Turn {
    string turnId
    string message
    TurnStatus status
    SubQuestion[] subQuestions
    Answer answer
    TokenUsage[] usage
    map toolCalls
    TurnContext context
    TraceEvent[] trace
    number createdAt
  }
  class SubQuestion {
    string q
    SubQuestionStatus status
    string findings
    Source[] sources
  }
  class SubResult {
    string q
    string findings
    Source[] sources
  }
  class Answer {
    string text
    Source[] citations
  }
  class Source {
    string id
    string title
    string url
  }
  class TokenUsage {
    string step
    string model
    number inputTokens
    number cachedTokens
    number outputTokens
  }
  class TraceEvent {
    string step
    string kind
    string detail
    string model
  }
  class TurnContext {
    number priorTurnsUsed
    number estimatedTokens
    number budgetTokens
    bool compacted
  }
  class Progress {
    string sessionId
    string status
    string currentTurnId
    bool compacting
  }
  Turn "1" o-- "many" SubQuestion
  Turn "1" o-- "1" Answer
  Turn "1" o-- "many" TokenUsage
  Turn "1" o-- "many" TraceEvent
  Turn "1" o-- "1" TurnContext
  SubQuestion "1" o-- "many" Source
  Answer "1" o-- "many" Source
  SubResult "1" o-- "many" Source
```

## 8. Session lifecycle

A session is a keyed Virtual Object. `start()` seeds it; each `sendTurn` moves the current turn through
`running → done/failed` while persisting progress, and follow-ups reuse prior turns. Sub-questions move
through their own `pending → running → done` states.

```mermaid
stateDiagram-v2
  [*] --> idle: start()
  idle --> running: sendTurn(message, turnId)
  running --> running: persist sub-questions, trace, usage
  running --> done: synthesis complete
  running --> failed: TerminalError
  done --> running: follow-up sendTurn (reuses journal)
  failed --> running: new sendTurn
  done --> [*]
```

```mermaid
stateDiagram-v2
  [*] --> pending: planner emits sub-question
  pending --> running: onInvestigationStart(i)
  running --> done: onInvestigationDone(i, result)
  done --> [*]
```

> Restate's single-writer guarantee makes `sendTurn` the only mutator while `getProgress` /
> `getResult` / `getTrace` / `getHistory` run as concurrent shared reads. Durable state survives server
> restarts.

## 9. Conversation journal and compaction

Refinement & reuse (Phase 7): each turn builds a journal of prior turns for the planner/synthesizer.
Stale turns expire; when the journal outgrows the token budget, the compactor folds the oldest into a
rolling summary.

```mermaid
flowchart TB
  newturn["new sendTurn"] --> load["load prior turns + order"]
  load --> filter["keep done + fresh (within FRESHNESS_TTL) + not summarized"]
  filter --> build["buildJournal: rolling summary + verbatim turns"]
  build --> est{"estTokens > CONTEXT_MAX_TOKENS and verbatim > MAX_JOURNAL_TURNS ?"}
  est -- no --> use["journal -> planner + synthesizer"]
  est -- yes --> fold["compactor folds oldest — ctx.run(compact)"]
  fold --> persist["persist journalSummary + summarizedTurnIds"]
  persist --> use
  use --> reuse["planner reuses answered angles; investigates only NEW sub-questions"]

  class fold,persist durable;
  classDef durable fill:#312e81,stroke:#6366f1,color:#fff;
```

> This is reuse, not idempotency: the planner sees earlier findings and only researches new angles, so
> a follow-up like *"go deeper on Snowflake margins"* issues fewer LLM/tool calls.

## 10. Durability and crash-resume

The headline property. Every external effect is wrapped in `ctx.run` under a stable, deterministic step
key, so on crash/redelivery completed steps replay from the journal instead of re-executing.

```mermaid
flowchart TB
  step["LLM / tool call wrapped in ctx.run(stableStep)"] --> resolved{"step already in journal ?"}
  resolved -- yes --> reuse["replay journaled result — NO external call"]
  resolved -- no --> exec["execute side effect — OpenAI / Tavily / fetch"]
  exec --> jrnl[("journal result under step key")]
  jrnl --> crash{"crash / pod kill before next step ?"}
  crash -- no --> next["continue to next step"]
  crash -- yes --> redeliver["Restate redelivers the invocation"]
  redeliver --> step
  reuse --> next

  class step,jrnl,reuse,exec durable;
  classDef durable fill:#312e81,stroke:#6366f1,color:#fff;
```

> Timeouts are tuned so long LLM calls are not mistaken for hangs: the service raises
> `RESTATE_INACTIVITY_TIMEOUT_MS` above the longest call, while OpenAI uses a shorter per-request
> timeout with `maxRetries=0` — retries belong to `ctx.run`.

## 11. Observability

Logs, the Restate journal, and the per-turn trace all key off the same stable step names, so you can
pivot across them by step name and invocation id.

```mermaid
flowchart LR
  step["stable step name<br/>planner · synthesizer · compact<br/>investigate:i:llm:n · :tool:n:k"]
  step --> t1["Tier-1 logs — ctx.console, replay-suppressed"]
  step --> t2["Restate journal / UI :9070 — full args + results"]
  step --> t3["Tier-2 trace — TraceEvent[] on Turn"]
  t3 --> read["getTrace shared handler / npm run cli trace"]
  t1 --> corr["correlate by step name + invocation id"]
  t2 --> corr
  t3 --> corr
```

## 12. Handler and endpoint map

Restate services and their handlers, and which CLI command drives each. The `session` object is the
stateful core; `investigator`, `health` and `greeter` are stateless services.

```mermaid
flowchart LR
  subgraph CLI["CLI commands"]
    c1["start"]
    c2["turn"]
    c3["progress"]
    c4["trace"]
    c5["health"]
  end
  subgraph SESS["session — Virtual Object"]
    h1["start (write)"]
    h2["sendTurn (write · single-writer)"]
    h3["getProgress (shared)"]
    h4["getResult (shared)"]
    h5["getTrace (shared)"]
    h6["getHistory (shared)"]
  end
  subgraph INV["investigator — Service"]
    h7["investigate"]
  end
  subgraph HLTH["health — Service"]
    h8["check"]
  end
  subgraph GRT["greeter — Service"]
    h9["greet"]
  end
  c1 --> h1
  c2 --> h2
  c2 --> h3
  c2 --> h4
  c3 --> h3
  c4 --> h5
  c5 --> h8
  h2 -->|"fan-out"| h7

  class h1,h2,h3,h4,h5,h6 durable;
  class h7,h8,h9 compute;
  classDef durable fill:#312e81,stroke:#6366f1,color:#fff;
  classDef compute fill:#0e7490,stroke:#22d3ee,color:#fff;
```

## 13. End-to-end user journey

From creating a session to a cited answer and a context-reusing follow-up — the whole demo path in one
view.

```mermaid
flowchart TB
  a["npm run cli start"] --> b["session.start() -> sessionId"]
  b --> c["npm run cli turn id 'Compare Datadog and Snowflake'"]
  c --> d["sendTurn — fire-and-forget with turnId"]
  d --> e["build journal from prior turns"]
  e --> f["planner decomposes into sub-questions"]
  f --> g["investigators run in parallel — web_search + fetch_page"]
  g --> h["synthesizer writes cited answer"]
  h --> i["CLI polls getProgress until done"]
  i --> j["getResult(turnId): answer + sources + tokens + tool counts"]
  j --> k["follow-up: 'go deeper on Snowflake margins' reuses the journal"]
  k --> e

  class b,d,e,f,h durable;
  class g compute;
  classDef durable fill:#312e81,stroke:#6366f1,color:#fff;
  classDef compute fill:#0e7490,stroke:#22d3ee,color:#fff;
```

## 14. Kubernetes deployment

Phase 11 runs the whole system on minikube. The Restate Operator reconciles a `RestateCluster`
(StatefulSet + PVC) and a `RestateDeployment` that it auto-registers and versions for zero-downtime
redeploys.

```mermaid
flowchart TB
  laptop["laptop CLI — port-forward 8080 / 9070"]
  subgraph mk["minikube cluster"]
    op["Restate Operator"]
    subgraph ns["namespace: restate"]
      rc["RestateCluster -> StatefulSet restate + Service + PVC 2Gi"]
      secret["Secret durable-research-secrets (from .env)"]
      cfg["ConfigMap durable-research-config"]
      subgraph rdg["RestateDeployment durable-research"]
        v1["ReplicaSet v1 — drains in-flight"]
        v2["ReplicaSet v2 — new turns"]
      end
    end
  end
  op --> rc
  op --> rdg
  op -->|"auto-register + version"| rc
  secret --> v2
  cfg --> v2
  laptop --> rc
  rc <--> v1
  rc <--> v2

  class rc,v1,v2 durable;
  class op,secret,cfg,laptop compute;
  classDef durable fill:#312e81,stroke:#6366f1,color:#fff;
  classDef compute fill:#0e7490,stroke:#22d3ee,color:#fff;
```

> On a new image tag the operator spins up `v2` and routes new invocations there while `v1` keeps
> running until its in-flight turns drain — a zero-downtime versioned redeploy. The PVC keeps durable
> state across pod restarts.

# Durable Multi-Agent Research

A proof-of-concept backend service that powers a multi-turn research assistant on top of
[Restate](https://docs.restate.dev) (a durable-execution engine). A user opens a session and sends
turns; the system decomposes each research question, investigates sub-questions in parallel, and
synthesizes a structured, cited answer. The headline property is **durability**: long-running research
survives process restarts, and expensive operations (LLM calls, web searches) are never repeated
unnecessarily.

See [`docs/requirements.md`](docs/requirements.md) for the full PRD, [`docs/TODO.md`](docs/TODO.md) for
the phased build plan, and [`docs/decisions.md`](docs/decisions.md) for the decision log.

> Status: **Phase 0** — project skeleton with a single durable "greeter" service that proves the
> Restate wiring end-to-end. The research agents land in later phases (see the TODO).

## Prerequisites

- **Node.js >= 20** (developed on Node 22).
- **Restate server + CLI.** Install per the [Restate docs](https://docs.restate.dev). Quick options:
  - macOS (Homebrew): `brew install restatedev/tap/restate-server restatedev/tap/restate`
  - or run on demand with `npx @restatedev/restate-server` and `npx @restatedev/restate`

## Setup

```bash
npm install
cp .env.example .env   # fill in values; not needed for the Phase 0 greeter
```

## Build & test

```bash
npm run build          # expect: tsc compiles to dist/ with no errors
npm test               # expect: all tests pass
```

## Run locally

The Restate server runs as a separate process in front of the service. Use three terminals:

```bash
# 1) Start the service (binds an HTTP/2 endpoint on :9080)
npm run dev            # expect: "Restate SDK started listening on 9080..."

# 2) Start the Restate server (ingress :8080, admin/UI :9070)
restate-server         # or: npx @restatedev/restate-server

# 3) Register this deployment with the server (one-time per restart of the service)
restate deployments register http://localhost:9080
```

Then call the durable handler through the Restate ingress:

```bash
curl localhost:8080/greeter/greet --json '{"name":"Ada"}'
# expect: "Hello, Ada! This durable greeter is alive."
```

You can inspect the execution journal (every durable step) in the Restate UI at
<http://localhost:9070>.

## Drive it with the CLI

With the service running and registered (see "Run locally"):

```bash
# create a session -> prints a session id
npm run cli start

# send a research turn, stream progress, then print the cited answer
npm run cli turn <sessionId> "Compare Datadog and Snowflake over the last three years"

# print current progress once
npm run cli progress <sessionId>
```

In Phase 2 the research is mocked ([`src/mock/research.ts`](src/mock/research.ts); see
[`docs/examples.md`](docs/examples.md)), but the durable Session object, observable progress, and
CLI are real. Kill the service mid-turn and restart it - the turn resumes where it left off.

## Project layout

```
src/
  app.ts              # endpoint entrypoint: binds services, listens on :9080
  cli.ts              # CLI client (start / turn / progress)
  greeting.ts         # pure greeting logic (unit-tested)
  services/
    greeter.ts        # Phase 0 durable "greeter" service
  session/
    session.ts        # durable Session virtual object (start/sendTurn/getProgress/getResult)
    types.ts          # session / turn / progress types
  mock/
    research.ts       # deterministic mocked research (Phase 2 stand-in)
docs/                 # PRD, TODO, traceability, decisions, examples
```

## Configuration

Configuration is via environment variables (see [`.env.example`](.env.example)). The Phase 0 greeter
only honours `PORT` (default `9080`); API keys and research settings are used from later phases.

## Continuous integration

GitHub Actions ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)) runs on every push and pull
request: lint + format check (Biome), typecheck, build, tests, a gitleaks secret scan, and a Docker
build with a startup smoke test. Local equivalents:

```bash
npm run lint        # Biome: lint + format + import-order check
npm run format      # Biome: auto-fix
npm run typecheck   # tsc --noEmit
npm run build
npm test
```

## Build the container

```bash
docker build -t durable-research .
docker run --rm -p 9080:9080 durable-research
# expect: "Restate SDK started listening on 9080..."
```

The image is multi-stage (build then a slim runtime), runs as a non-root user, and exposes `9080`.
Register it with a running Restate server exactly as in "Run locally".

## Rotating keys

Secrets live only in `.env` (gitignored); the repo ships `.env.example` placeholders, and CI runs
gitleaks to catch accidental commits. To rotate a key: revoke/replace `OPENAI_API_KEY` /
`TAVILY_API_KEY` at the provider, update your local `.env`, and restart the service. If a key is ever
committed, rotate it immediately — repository history is public.

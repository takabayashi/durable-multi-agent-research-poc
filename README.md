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

## Project layout

```
src/
  app.ts              # endpoint entrypoint: binds services, listens on :9080
  greeting.ts         # pure greeting logic (unit-tested)
  greeting.test.ts    # Vitest unit test
  services/
    greeter.ts        # Phase 0 durable "greeter" service
docs/                 # PRD, TODO, traceability, decisions
```

## Configuration

Configuration is via environment variables (see [`.env.example`](.env.example)). The Phase 0 greeter
only honours `PORT` (default `9080`); API keys and research settings are used from later phases.

# Example queries

Queries used for demos and (later) integration tests. The planner and synthesizer are real LLM calls,
and each sub-question is investigated by a real ReAct loop over `web_search` (Tavily) + `fetch_page`
(see [`prompts.md`](./prompts.md)), so answers cite real sources. The planner still decides
decomposition vs. an immediate answer. Drive them with the CLI (see the README):
`npm run cli turn <sessionId> "<query>"` (needs `OPENAI_API_KEY` + `TAVILY_API_KEY`).

- **Q1 (canonical):** "Compare the performance of Datadog and Snowflake over the last three years -
  revenue, profit, margins, NRR - and analyze trends and developments."
  Decomposes into parallel sub-questions; primary refinement + supersession target.
- **Q2 (technical):** "What are the architectural trade-offs between Postgres and MySQL for
  high-write workloads, and when would you pick each?"
- **Q3 (time-sensitive):** "Summarize the current status of the EU AI Act: key obligations,
  compliance timelines, and who is affected." (Exercises recency / freshness later.)
- **Q4 (single-entity):** "Give an overview of Restate (durable execution): the problem it solves,
  core primitives, and how it compares to Temporal."
- **Q5 (immediate):** "What does NRR stand for?" - answered directly, no decomposition.
- **Q6 (refinement of Q1):** "Go deeper on point 3 (margins): split gross vs operating."
  Supersession pair for Q1: "Ignore Snowflake - compare Datadog with Cloudflare instead."

Refinement (Q6) and supersession land in later phases; for now each turn is independent.

import { randomUUID } from "node:crypto";
import { connect } from "@restatedev/restate-sdk-clients";
import type { SessionObject } from "./session/session.js";
import type { Progress } from "./session/types.js";

const INGRESS_URL = process.env.RESTATE_INGRESS_URL ?? "http://localhost:8080";
const SESSION = { name: "session" } as const;

function ingress() {
  return connect({ url: INGRESS_URL });
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

function renderProgress(p: Progress): string {
  const header = `[${p.status}] ${p.message ?? "(no active turn)"}`;
  const lines = p.subQuestions.map((sq) => `  - [${sq.status}] ${sq.q}`);
  return [header, ...lines].join("\n");
}

async function cmdStart(): Promise<void> {
  const id = randomUUID();
  const res = await ingress().objectClient<SessionObject>(SESSION, id).start();
  console.log(res.sessionId);
}

async function cmdTurn(sessionId: string, message: string): Promise<void> {
  const rs = ingress();
  const obj = rs.objectClient<SessionObject>(SESSION, sessionId);

  // Fire-and-forget the (long-running) turn, then poll progress until it finishes.
  await rs.objectSendClient<SessionObject>(SESSION, sessionId).sendTurn({ message });

  let last = "";
  let done = false;
  while (!done) {
    const p = await obj.getProgress();
    const rendered = renderProgress(p);
    if (rendered !== last) {
      console.log(rendered);
      last = rendered;
    }
    done = p.status === "done" || p.status === "failed";
    if (!done) {
      await sleep(700);
    }
  }

  const result = await obj.getResult({});
  if (result?.answer) {
    console.log(`\nAnswer:\n${result.answer.text}`);
    if (result.answer.citations.length > 0) {
      console.log("\nSources:");
      for (const c of result.answer.citations) {
        console.log(`  - [${c.id}] ${c.title} (${c.url})`);
      }
    }
  }

  if (result?.usage && result.usage.length > 0) {
    const byModel = new Map<string, { input: number; cached: number; output: number }>();
    for (const u of result.usage) {
      const agg = byModel.get(u.model) ?? { input: 0, cached: 0, output: 0 };
      agg.input += u.inputTokens;
      agg.cached += u.cachedTokens;
      agg.output += u.outputTokens;
      byModel.set(u.model, agg);
    }
    console.log("\nTokens (this turn):");
    for (const [model, t] of byModel) {
      console.log(`  - ${model}: in=${t.input} cached=${t.cached} out=${t.output}`);
    }
  }
}

async function cmdProgress(sessionId: string): Promise<void> {
  const p = await ingress().objectClient<SessionObject>(SESSION, sessionId).getProgress();
  console.log(renderProgress(p));
}

function usage(): void {
  console.log(
    [
      "Usage:",
      "  npm run cli start                      # create a session, print its id",
      '  npm run cli turn <sessionId> "<msg>"   # send a turn and stream progress',
      "  npm run cli progress <sessionId>       # print current progress once",
    ].join("\n"),
  );
}

async function main(): Promise<void> {
  const [cmd, ...args] = process.argv.slice(2);
  switch (cmd) {
    case "start":
      await cmdStart();
      break;
    case "turn": {
      const [sessionId, ...rest] = args;
      const message = rest.join(" ").trim();
      if (!sessionId || message.length === 0) {
        usage();
        process.exitCode = 1;
        return;
      }
      await cmdTurn(sessionId, message);
      break;
    }
    case "progress": {
      const [sessionId] = args;
      if (!sessionId) {
        usage();
        process.exitCode = 1;
        return;
      }
      await cmdProgress(sessionId);
      break;
    }
    default:
      usage();
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

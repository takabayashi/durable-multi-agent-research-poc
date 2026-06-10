import { randomUUID } from "node:crypto";
import { parseArgs } from "node:util";
import { connect } from "@restatedev/restate-sdk-clients";
import { formatTurnResult, renderProgress } from "./cli.output.js";
import type { SessionObject } from "./session/session.js";

const INGRESS_URL = process.env.RESTATE_INGRESS_URL ?? "http://localhost:8080";
const SESSION = { name: "session" } as const;

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Request + send clients for one session, sharing a single ingress connection. */
function sessionClients(sessionId: string) {
  const rs = connect({ url: INGRESS_URL });
  return {
    obj: rs.objectClient<SessionObject>(SESSION, sessionId),
    send: rs.objectSendClient<SessionObject>(SESSION, sessionId),
  };
}

async function cmdStart(): Promise<void> {
  const res = await sessionClients(randomUUID()).obj.start();
  console.log(res.sessionId);
}

async function cmdTurn(sessionId: string, message: string): Promise<void> {
  const { obj, send } = sessionClients(sessionId);

  // Fire-and-forget the (long-running) turn with a client-supplied id, then poll
  // progress for *this* turn id — so we never mistake a just-finished prior turn for
  // ours, and we don't block the CLI on the whole turn's request-response.
  const turnId = randomUUID();
  await send.sendTurn({ message, turnId });

  console.log("SessionId: ", sessionId, " | TurnId: ", turnId);

  let last = "";
  let done = false;
  while (!done) {
    const p = await obj.getProgress();
    // Only trust progress once it reflects the turn we submitted; otherwise we may
    // observe the previous (already-done) turn before ours registers.
    const isOurTurn = p.currentTurnId === turnId;
    if (isOurTurn) {
      const rendered = renderProgress(p);
      if (rendered !== last) {
        console.log(rendered);
        last = rendered;
      }
      done = p.status === "done" || p.status === "failed";
    }
    if (!done) {
      await sleep(700);
    }
  }

  const result = await obj.getResult({ turnId });
  const out = result ? formatTurnResult(result) : "";
  if (out) {
    console.log(out);
  }
}

async function cmdProgress(sessionId: string): Promise<void> {
  const p = await sessionClients(sessionId).obj.getProgress();
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
  const { positionals } = parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    strict: false,
  });
  const [cmd, sessionId, ...rest] = positionals;

  switch (cmd) {
    case "start":
      await cmdStart();
      break;
    case "turn": {
      const message = rest.join(" ").trim();
      if (!sessionId || message.length === 0) {
        usage();
        process.exitCode = 1;
        return;
      }
      await cmdTurn(sessionId, message);
      break;
    }
    case "progress":
      if (!sessionId) {
        usage();
        process.exitCode = 1;
        return;
      }
      await cmdProgress(sessionId);
      break;
    default:
      usage();
      process.exitCode = cmd ? 1 : 0;
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exitCode = 1;
});

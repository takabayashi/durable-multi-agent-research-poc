import * as restate from "@restatedev/restate-sdk";
import { investigator } from "./agents/investigator.js";
import { greeter } from "./services/greeter.js";
import { health } from "./services/health.js";
import { session } from "./session/session.js";

const port = Number(process.env.PORT ?? 9080);

// Serve the Restate services over HTTP/2. The Restate server (run separately)
// discovers this endpoint when the deployment is registered.
await restate.serve({ services: [greeter, session, investigator, health], port });

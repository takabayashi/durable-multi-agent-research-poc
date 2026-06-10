import * as restate from "@restatedev/restate-sdk";
import { greeter } from "./services/greeter.js";

const port = Number(process.env.PORT ?? 9080);

// Serve the Restate services over HTTP/2. The Restate server (run separately)
// discovers this endpoint when the deployment is registered.
restate.endpoint().bind(greeter).listen(port);

import { createWorldServer } from "./server.js";
import { ideas, ideasReady } from "./ideas/index.js";
import { emitWarning } from "node:process";

const port = Number(process.env.PORT ?? 2567);

await ideasReady;
const server = createWorldServer();
await server.listen(port);

console.log(`[world-server] listening on ws://localhost:${port}`);

process.on("uncaughtException", (err) => {
  console.error("[world-server] uncaughtException:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("[world-server] unhandledRejection:", reason);
});

// Make sure the last Idea Wall change reaches the disk before we go.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await ideas.flush();
    process.exit(0);
  });
}
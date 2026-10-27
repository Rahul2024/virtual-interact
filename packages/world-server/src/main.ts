import { createWorldServer } from "./server.js";
import { ideas, ideasReady } from "./ideas/index.js";
import { emitWarning } from "node:process";

const port = Number(process.env.PORT ?? 2567);

await ideasReady;
const server = createWorldServer();
await server.listen(port);

console.log(`[world-server] listening on ws://localhost:${port}`);

// Make sure the last Idea Wall change reaches the disk before we go.
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, async () => {
    await ideas.flush();
    process.exit(0);
  });
}
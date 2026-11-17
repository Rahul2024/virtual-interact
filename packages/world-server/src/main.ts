import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Load packages/world-server/.env ourselves (ADMIN_KEY, Upstash, ...), so it
// works however the server is started. Existing environment wins.
try {
  const envFile = readFileSync(resolve(process.cwd(), ".env"), "utf8");
  for (const raw of envFile.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (!(key in process.env) && value) process.env[key] = value;
  }
} catch {
  /* no .env: fine */
}

import { matchMaker } from "colyseus";
import { ROOMS } from "@vi/shared";
import { createWorldServer } from "./server.js";
import { ideas, ideasReady } from "./ideas/index.js";

const port = Number(process.env.PORT ?? 2567);

await ideasReady;
const server = createWorldServer();
await server.listen(port);

// Pre-create the persistent Hub room so the world & its NPCs stay live 24/7.
try {
  await matchMaker.createRoom(ROOMS.hub, {});
  console.log("[world-server] persistent 24/7 Hub room initialized");
} catch (err) {
  console.warn("[world-server] could not pre-create hub room:", err);
}

// Self keep-alive ping every 5 minutes so free cloud hosts (e.g. Render) stay warm.
const keepAliveUrl = process.env.RENDER_EXTERNAL_URL
  ? `${process.env.RENDER_EXTERNAL_URL.replace(/\/$/, "")}/health`
  : `http://localhost:${port}/health`;
setInterval(() => {
  fetch(keepAliveUrl).catch(() => {});
}, 5 * 60 * 1000);

console.log(`[world-server] listening on ws://localhost:${port}`);
console.log(`[world-server] moderator key ${process.env.ADMIN_KEY ? "set" : "NOT set (add ADMIN_KEY to packages/world-server/.env)"}`);

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
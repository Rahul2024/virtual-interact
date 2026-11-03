import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@colyseus/sdk";
import { ADMIN_MSG, CLOSE, ROOMS } from "@vi/shared";
import { createWorldServer } from "../src/server.js";
import type { HubState } from "../src/rooms/HubState.js";

process.env.ADMIN_KEY = "test-admin-key";

const PORT = 20000 + Math.floor(Math.random() * 10000);
const server = createWorldServer();

before(async () => {
  await server.listen(PORT);
});
after(async () => {
  await server.gracefullyShutdown(false);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check: () => boolean, timeoutMs = 3000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > timeoutMs) throw new Error("timed out");
    await sleep(25);
  }
}

test("presence: rejoining from the same browser replaces the old body", async () => {
  const client = new Client(`ws://localhost:${PORT}`);
  const first = await client.joinOrCreate<HubState>(ROOMS.hub, { name: "Rahul", color: "#f26d6d", clientId: "browser-abc-123" });
  let firstClosed = -1;
  first.onLeave((code) => (firstClosed = code));
  const watcher = await client.joinOrCreate<HubState>(ROOMS.hub, { name: "Watcher", color: "#5b8def", clientId: "browser-watcher" });
  await waitFor(() => (watcher.state?.players?.size ?? 0) === 2);

  // Same browser id joins again (reload, new tab): the old session is replaced, not duplicated.
  const second = await client.joinOrCreate<HubState>(ROOMS.hub, { name: "Rahul again", color: "#f26d6d", clientId: "browser-abc-123" });
  await waitFor(() => firstClosed !== -1);
  assert.equal(firstClosed, CLOSE.replaced);
  await sleep(100);
  const names = [...watcher.state.players.values()].map((p) => p.name).sort();
  assert.deepEqual(names, ["Rahul again", "Watcher"], "exactly one Rahul in the room");

  await second.leave();
  await watcher.leave();
});

test("admin: wrong key is refused; right key can kick, ban and set the sky", async () => {
  const client = new Client(`ws://localhost:${PORT}`);
  const admin = await client.joinOrCreate<HubState>(ROOMS.hub, { name: "Dev", color: "#f26d6d", clientId: "browser-dev-1" });
  const victim = await client.joinOrCreate<HubState>(ROOMS.hub, { name: "Troll", color: "#5b8def", clientId: "browser-troll-1" });
  let victimClosed = -1;
  victim.onLeave((code) => (victimClosed = code));
  await waitFor(() => (admin.state?.players?.size ?? 0) >= 2);

  // Not logged in: commands are ignored.
  admin.send(ADMIN_MSG.time, { mode: "night" });
  await sleep(100);
  assert.equal(admin.state.timeMode, "auto");

  const bad = await admin.request<unknown, { ok: boolean }>(ADMIN_MSG.login, { key: "nope" });
  assert.equal(bad.ok, false);
  const good = await admin.request<unknown, { ok: boolean }>(ADMIN_MSG.login, { key: "test-admin-key" });
  assert.equal(good.ok, true);

  admin.send(ADMIN_MSG.time, { mode: "night" });
  await waitFor(() => admin.state.timeMode === "night");

  // Ban the troll: kicked now, and the same browser cannot come back.
  admin.send(ADMIN_MSG.ban, { sessionId: victim.sessionId });
  await waitFor(() => victimClosed !== -1);
  assert.equal(victimClosed, CLOSE.banned);
  await assert.rejects(client.joinOrCreate(ROOMS.hub, { name: "Troll", color: "#5b8def", clientId: "browser-troll-1" }));

  // Put the sky back for the other tests.
  admin.send(ADMIN_MSG.time, { mode: "auto" });
  await waitFor(() => admin.state.timeMode === "auto");
  await admin.leave();
});

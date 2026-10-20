import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client, Callbacks } from "@colyseus/sdk";
import { ANIM, MSG, ROOMS, type ChatBroadcast } from "@vi/shared";
import { createWorldServer } from "../src/server.js";
import type { HubState } from "../src/rooms/HubState.js";

const PORT = 20000 + Math.floor(Math.random() * 10000);
const server = createWorldServer();

before(async () => {
  await server.listen(PORT);
});

after(async () => {
  await server.gracefullyShutdown(false);
});

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitFor(check: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!check()) {
    if (Date.now() - start > timeoutMs) throw new Error("timed out waiting for condition");
    await sleep(25);
  }
}

test("two people join the hub and see each other move and chat", async () => {
  const client = new Client(`ws://localhost:${PORT}`);

  const alice = await client.joinOrCreate<HubState>(ROOMS.hub, { name: "Alice", color: "#f26d6d" });
  const bob = await client.joinOrCreate<HubState>(ROOMS.hub, { name: "Bob", color: "#5b8def" });
  assert.equal(alice.roomId, bob.roomId, "both land in the same hub instance");

  // Bob's view of the world.
  const seen = new Map<string, { name: string; x: number; z: number; anim: number }>();
  const bobCallbacks = Callbacks.get(bob);
  bobCallbacks.onAdd("players", (player, id) => {
    seen.set(id, { name: player.name, x: player.x, z: player.z, anim: player.anim });
    bobCallbacks.onChange(player, () => {
      seen.set(id, { name: player.name, x: player.x, z: player.z, anim: player.anim });
    });
  });
  bobCallbacks.onRemove("players", (_player, id) => {
    seen.delete(id);
  });

  await waitFor(() => seen.size === 2);
  assert.equal(seen.get(alice.sessionId)?.name, "Alice");
  assert.equal(seen.get(bob.sessionId)?.name, "Bob");

  // Alice walks a plausible distance (one 10 Hz tick of walking); Bob sees it.
  await sleep(120);
  const start = seen.get(alice.sessionId)!;
  alice.send(MSG.move, { x: start.x + 0.3, z: start.z + 0.3, rot: 1, anim: ANIM.walk });
  await waitFor(() => {
    const p = seen.get(alice.sessionId)!;
    return Math.abs(p.x - (start.x + 0.3)) < 0.01 && p.anim === ANIM.walk;
  });

  // Alice tries to teleport 50 m in one tick; the server pulls her back.
  const before = seen.get(alice.sessionId)!;
  alice.send(MSG.move, { x: before.x + 50, z: before.z, rot: 0, anim: ANIM.run });
  await sleep(200);
  const after = seen.get(alice.sessionId)!;
  assert.ok(after.x - before.x < 5, `teleport was clamped (moved ${after.x - before.x} m)`);

  // Chat reaches everyone, including the sender.
  const heard: ChatBroadcast[] = [];
  bob.onMessage(MSG.chat, (m: ChatBroadcast) => heard.push(m));
  alice.onMessage(MSG.chat, () => {});
  alice.send(MSG.chat, { text: "  hello bob <3  " });
  await waitFor(() => heard.length === 1);
  assert.equal(heard[0]!.name, "Alice");
  assert.equal(heard[0]!.text, "hello bob <3");

  // Leaving removes you from everyone's state.
  await alice.leave();
  await waitFor(() => seen.size === 1);

  await bob.leave();
});

test("/health answers with a headcount", async () => {
  const client = new Client(`ws://localhost:${PORT}`);
  const room = await client.joinOrCreate<HubState>(ROOMS.hub, { name: "Ping", color: "#5b8def" });
  const res = await fetch(`http://localhost:${PORT}/health`);
  assert.equal(res.status, 200);
  const body = (await res.json()) as { ok: boolean; hubs: number; people: number };
  assert.equal(body.ok, true);
  assert.ok(body.hubs >= 1);
  assert.ok(body.people >= 1);
  await room.leave();
});

test("junk input is sanitised, not trusted", async () => {
  const client = new Client(`ws://localhost:${PORT}`);
  const room = await client.joinOrCreate<HubState>(ROOMS.hub, { name: "<script>x</script>", color: "red" });

  const callbacks = Callbacks.get(room);
  let me: HubState["players"] extends Map<string, infer P> ? P | undefined : never;
  callbacks.onAdd("players", (player, id) => {
    if (id === room.sessionId) me = player;
  });
  await waitFor(() => me !== undefined);

  assert.equal(me!.name, "scriptxscript");
  assert.equal(me!.color, "#5b8def", "invalid colour falls back to the default");

  await room.leave();
});

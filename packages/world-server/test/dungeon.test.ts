import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@colyseus/sdk";
import { ANIM, BRICK_DUNGEON, MSG, ROOMS, chestAt, dungeonClosedDoors } from "@vi/shared";
import { createWorldServer } from "../src/server.js";
import type { HubState } from "../src/rooms/HubState.js";

// ---- Shared geometry ----------------------------------------------------------

test("dungeon doors: the closed set follows the flags", () => {
  const allClosed = dungeonClosedDoors({ dungeonWing: 1, grimoireFound: 0, websBurned: 0, gateLeftOpen: 0, gateRightOpen: 0 });
  assert.deepEqual(
    allClosed.map((d) => d.door).sort(),
    ["bookcase", "gateLeft", "gateRight", "partition", "web1", "web2", "web3"],
  );
  // Wing 1 = west open, so the closed partition is on the east (positive x).
  const partition = allClosed.find((d) => d.door === "partition")!;
  assert.ok(partition.x > 0);
  assert.ok(partition.x - partition.hw >= BRICK_DUNGEON.partitionInnerX - 1e-9);

  const opened = dungeonClosedDoors({ dungeonWing: 2, grimoireFound: 1, websBurned: 0b101, gateLeftOpen: 1, gateRightOpen: 0 });
  assert.deepEqual(opened.map((d) => d.door).sort(), ["gateRight", "partition", "web2"]);
  assert.ok(opened.find((d) => d.door === "partition")!.x < 0, "wing 2 closes the west side");
});

test("dungeon chests: chestAt agrees with where the chests are drawn", () => {
  const z = BRICK_DUNGEON.chestZ;
  assert.equal(chestAt(BRICK_DUNGEON.chestXs[0], z), 1);
  assert.equal(chestAt(0, z), 2);
  assert.equal(chestAt(BRICK_DUNGEON.chestXs[2] + 1, z), 3);
  assert.equal(chestAt(0, z - 10), 0, "too far away");
  assert.equal(chestAt(2.6, z), 0, "exactly between two chests is nobody's chest");
});

// ---- Server enforcement -----------------------------------------------------------

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

test("dungeon walls: running at the secret bookcase does not get you through", async () => {
  const client = new Client(`ws://localhost:${PORT}`);
  const room = await client.joinOrCreate<HubState>(ROOMS.hub, { name: "Runner", color: "#5b8def" });
  await sleep(100);

  // Walk, in plausible steps, from the spawn to just before the bookcase.
  // Each step is 0.9 m, under the server's per-tick speed allowance.
  const me = () => room.state.players.get(room.sessionId)!;
  let z = me().z;
  // West walkway: dry across the canal, clear of arrows and slabs, and wing 1 leaves the west side of the partition open.
  const x = -14;
  const target = BRICK_DUNGEON.secretWallZ - 2.5;
  while (z < target) {
    z = Math.min(target, z + 0.9);
    room.send(MSG.move, { x, z, rot: 0, anim: ANIM.run });
    await sleep(60);
  }
  await sleep(150);
  assert.ok(Math.abs(me().z - target) < 0.3, `reached the bookcase (${me().z})`);

  // Now sprint through the door in 0.9 m steps for 6 m.
  for (let i = 1; i <= 7; i++) {
    room.send(MSG.move, { x, z: target + i * 0.9, rot: 0, anim: ANIM.run });
    await sleep(60);
  }
  await sleep(200);
  assert.ok(me().z < BRICK_DUNGEON.secretWallZ, `server kept us on this side of the bookcase (${me().z})`);

  await room.leave();
});

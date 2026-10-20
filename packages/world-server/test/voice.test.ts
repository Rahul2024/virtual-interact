import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { Client } from "@colyseus/sdk";
import { ROOMS } from "@vi/shared";
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
    await sleep(20);
  }
}

test("voice signaling: peers list, peer-joined, offer/answer/ice relay, peer-left", async () => {
  const client = new Client(`ws://localhost:${PORT}`);
  const alice = await client.joinOrCreate<HubState>(ROOMS.hub, { name: "Alice", color: "#f26d6d" });
  const bob = await client.joinOrCreate<HubState>(ROOMS.hub, { name: "Bob", color: "#5b8def" });

  const aliceLog: Array<[string, unknown]> = [];
  const bobLog: Array<[string, unknown]> = [];
  for (const type of ["webrtc:peers", "webrtc:peer-joined", "webrtc:peer-left", "webrtc:offer", "webrtc:answer", "webrtc:ice-candidate"]) {
    alice.onMessage(type, (m: unknown) => aliceLog.push([type, m]));
    bob.onMessage(type, (m: unknown) => bobLog.push([type, m]));
  }

  // Alice opts in first: nobody else is in the mesh yet.
  alice.send("webrtc:join");
  await waitFor(() => aliceLog.some(([t]) => t === "webrtc:peers"));
  assert.deepEqual(aliceLog.find(([t]) => t === "webrtc:peers")![1], []);

  // Bob opts in: he learns about Alice, Alice learns about him.
  bob.send("webrtc:join");
  await waitFor(() => bobLog.some(([t]) => t === "webrtc:peers") && aliceLog.some(([t]) => t === "webrtc:peer-joined"));
  assert.deepEqual(bobLog.find(([t]) => t === "webrtc:peers")![1], [alice.sessionId]);
  assert.equal(aliceLog.find(([t]) => t === "webrtc:peer-joined")![1], bob.sessionId);

  // A big offer (bigger than the old 4 KB limit) gets through, tagged with the sender.
  const bigSdp = "v=0\r\n" + "a=candidate:fake ".repeat(400);
  assert.ok(bigSdp.length > 4096);
  bob.send("webrtc:offer", { targetId: alice.sessionId, sdp: bigSdp });
  await waitFor(() => aliceLog.some(([t]) => t === "webrtc:offer"));
  const offer = aliceLog.find(([t]) => t === "webrtc:offer")![1] as { peerId: string; sdp: string };
  assert.equal(offer.peerId, bob.sessionId);
  assert.equal(offer.sdp, bigSdp);

  alice.send("webrtc:answer", { targetId: bob.sessionId, sdp: "answer" });
  alice.send("webrtc:ice-candidate", { targetId: bob.sessionId, candidate: { candidate: "c", sdpMid: "0" } });
  await waitFor(() => bobLog.some(([t]) => t === "webrtc:answer") && bobLog.some(([t]) => t === "webrtc:ice-candidate"));

  // Leaving tells the others.
  await bob.leave();
  await waitFor(() => aliceLog.some(([t]) => t === "webrtc:peer-left"));
  assert.equal(aliceLog.find(([t]) => t === "webrtc:peer-left")![1], bob.sessionId);

  await alice.leave();
});

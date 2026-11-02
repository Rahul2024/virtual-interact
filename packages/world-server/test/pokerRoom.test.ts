import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { Client, Callbacks } from "@colyseus/sdk";
import { POKER_MSG, POKER_ROOM, type PokerEventMessage } from "@vi/shared/poker";
import { createWorldServer } from "../src/server.js";
import type { PokerTableState } from "../src/rooms/PokerState.js";

const PORT = 20000 + Math.floor(Math.random() * 10000);
const server = createWorldServer();

before(async () => {
  await server.listen(PORT);
});
after(async () => {
  await server.gracefullyShutdown(false);
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor(check: () => boolean, timeoutMs = 4000) {
  const t0 = Date.now();
  while (!check()) {
    if (Date.now() - t0 > timeoutMs) throw new Error("timed out");
    await sleep(25);
  }
}

test("poker room: private hole cards, host start, a hand plays out, deck commitment verifies", async () => {
  const client = new Client(`ws://localhost:${PORT}`);
  const alice = await client.joinOrCreate<PokerTableState>(POKER_ROOM, { tableId: "test-table" });
  const bob = await client.joinById<PokerTableState>("test-table");
  const events: PokerEventMessage[] = [];
  alice.onMessage(POKER_MSG.event, (e: PokerEventMessage) => events.push(e));
  bob.onMessage(POKER_MSG.event, () => {});

  // Host (first joiner) sets the table; a non-host cannot.
  alice.send(POKER_MSG.config, { smallBlind: 5, bigBlind: 10, minBuyIn: 200, maxBuyIn: 1000, actionSeconds: 10 });
  bob.send(POKER_MSG.config, { bigBlind: 50 });
  await waitFor(() => alice.state.bigBlind === 10);
  await sleep(100);
  assert.equal(alice.state.bigBlind, 10, "non-host config ignored");

  alice.send(POKER_MSG.sit, { seat: 2, buyIn: 500, name: "Alice", color: "#f26d6d" });
  bob.send(POKER_MSG.sit, { seat: 6, buyIn: 300, name: "Bob", color: "#5b8def" });
  await waitFor(() => alice.state.seats[2]!.stack === 500 && alice.state.seats[6]!.stack === 300);
  assert.equal(alice.state.seats[2]!.status, "sitting");

  // Only the host can start.
  bob.send(POKER_MSG.start);
  await sleep(100);
  assert.equal(alice.state.phase, "lobby");
  alice.send(POKER_MSG.start);
  await waitFor(() => alice.state.phase === "acting", 8000);

  // Privacy: each sees their own two cards and nobody else's.
  const aliceMine = alice.state.seats[2]!.holeCards;
  const aliceSeesBob = alice.state.seats[6]!.holeCards;
  const bobMine = bob.state.seats[6]!.holeCards;
  const bobSeesAlice = bob.state.seats[2]!.holeCards;
  assert.equal(aliceMine?.length, 2, "Alice has her two cards");
  assert.equal(bobMine?.length, 2, "Bob has his two cards");
  assert.ok(!aliceSeesBob || aliceSeesBob.length === 0, "Alice cannot see Bob's cards");
  assert.ok(!bobSeesAlice || bobSeesAlice.length === 0, "Bob cannot see Alice's cards");
  assert.ok(alice.state.deckCommitment.length === 64, "commitment published before the deal");

  // Heads-up: button posts the small blind and acts first.
  const button = alice.state.button;
  assert.equal(alice.state.toAct, button);
  const toRoom = (seat: number) => (seat === 2 ? alice : bob);

  // Button raises to 30, the other calls, then everyone checks it down.
  toRoom(alice.state.toAct).send(POKER_MSG.action, { action: { type: "raise", to: 30 } });
  await waitFor(() => alice.state.currentBet === 30);
  toRoom(alice.state.toAct).send(POKER_MSG.action, { action: { type: "call" } });
  await waitFor(() => alice.state.street === "flop" && alice.state.phase === "acting", 6000);
  assert.equal(alice.state.board.length, 3);
  assert.equal(alice.state.potTotal, 60);

  // Check it down: whoever is on the clock checks, until the dealer pays the pot.
  const deadline = Date.now() + 20000;
  while (alice.state.phase !== "showdown") {
    if (Date.now() > deadline) throw new Error(`stuck at ${alice.state.street}/${alice.state.phase}`);
    if (alice.state.phase === "acting" && alice.state.toAct !== -1) {
      const seat = alice.state.toAct;
      toRoom(seat).send(POKER_MSG.action, { action: { type: "check" } });
      await waitFor(() => alice.state.toAct !== seat || alice.state.phase !== "acting", 3000);
    } else {
      await sleep(50);
    }
  }

  // Chips conserved, someone was paid, the seed verifies the commitment.
  assert.equal(alice.state.seats[2]!.stack + alice.state.seats[6]!.stack, 800);
  assert.ok(events.some((e) => e.kind === "award"));
  const seed = alice.state.lastSeed;
  const deck = alice.state.lastDeck;
  assert.ok(seed && deck);
  const check = createHash("sha256").update(`${seed}:${deck}`).digest("hex");
  assert.equal(check, alice.state.deckCommitment, "published hash matches the revealed deck");
  // The revealed deck starts with the hole cards that were actually dealt (SB first).
  assert.equal(deck.split(" ").length, 52);

  await alice.leave();
  await bob.leave();
});

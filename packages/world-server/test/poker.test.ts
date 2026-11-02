import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HandCategory,
  applyAction,
  chipsForBet,
  compareHands,
  computePots,
  describeHand,
  evaluateBest,
  freshDeck,
  legalActions,
  makeChange,
  parseCards,
  rackStartingStack,
  seededRandomInt,
  shuffle,
  splitPot,
  stackTotal,
  startHand,
  type Card,
  type HandState,
} from "@vi/shared/poker";

// ---- Evaluator --------------------------------------------------------------------

test("poker: hand categories and tie-breaks", () => {
  const h = (s: string) => evaluateBest(parseCards(s));
  assert.equal(h("As Ks Qs Js Ts 2c 3d").category, HandCategory.StraightFlush);
  assert.equal(describeHand(h("As Ks Qs Js Ts 2c 3d")), "Royal flush");
  assert.equal(h("9c 9d 9h 9s 2c").category, HandCategory.Quads);
  assert.equal(h("Kc Kd Kh 4s 4c").category, HandCategory.FullHouse);
  assert.equal(describeHand(h("Kc Kd Kh 4s 4c")), "Full house, Kings full of Fours");
  assert.equal(h("2h 7h 9h Jh Kh").category, HandCategory.Flush);
  assert.equal(h("4c 5d 6h 7s 8c").category, HandCategory.Straight);
  // The wheel: ace plays low, and it is the lowest straight.
  const wheel = h("Ac 2d 3h 4s 5c");
  assert.equal(wheel.category, HandCategory.Straight);
  assert.ok(compareHands(h("2c 3d 4h 5s 6c"), wheel) > 0, "six-high beats the wheel");
  // Q-K-A-2-3 is not a straight.
  assert.equal(h("Qc Kd Ah 2s 3c").category, HandCategory.HighCard);
  assert.equal(h("7c 7d 7h Ks Qc").category, HandCategory.Trips);
  assert.equal(describeHand(h("Qc Qd 8h 8s Ac")), "Two pair, Queens and Eights, Ace kicker");
  assert.equal(h("Jc Jd 8h 4s Ac").category, HandCategory.Pair);
  // Kickers decide, suits never do.
  assert.ok(compareHands(h("Ac Ad Kh 7s 2c"), h("As Ah Qd 7c 2d")) > 0);
  assert.equal(compareHands(h("Ac Kd 9h 7s 2c"), h("As Kh 9d 7c 2d")), 0, "same ranks, different suits: exact tie");
});

test("poker: best five of seven, and the board can play", () => {
  // Wikipedia's example: both have queens and eights; the ace on the board kills Bob's king kicker.
  const board = parseCards("Qc 8d 2h 8s Ac");
  const bob = evaluateBest([...parseCards("Qh Kd"), ...board]);
  const carol = evaluateBest([...parseCards("Qs 9c"), ...board]);
  assert.equal(compareHands(bob, carol), 0, "they split: A-Q-Q-8-8 for both");
  // Three nines with K-Q kickers beats kings and nines with a jack kicker.
  const b2 = parseCards("9c Kd Qh 4s 9h");
  const trips = evaluateBest([...parseCards("9d 2c"), ...b2]);
  const twoPair = evaluateBest([...parseCards("Kh Jc"), ...b2]);
  assert.ok(compareHands(trips, twoPair) > 0);
});

// ---- Pots --------------------------------------------------------------------------

test("poker: side pots, the textbook case", () => {
  // A 30, B 10 all-in, C 30 all-in → main 30 (A,B,C), side 40 (A,C)
  const pots = computePots([30, 10, 30], [false, false, false]);
  assert.deepEqual(pots, [
    { amount: 30, eligible: [0, 1, 2] },
    { amount: 40, eligible: [0, 2] },
  ]);
  // Folded players feed pots but can't win them; an unmatched bet forms a one-player layer.
  const pots2 = computePots([50, 20, 20], [false, true, false]);
  assert.deepEqual(pots2, [
    { amount: 60, eligible: [0, 2] },
    { amount: 30, eligible: [0] },
  ]);
});

test("poker: split pot odd chips go clockwise from the button", () => {
  // 101 between seats 2 and 5 with the button on seat 4: seat 5 is first left of the button.
  const shares = splitPot(101, [2, 5], 4, 6);
  assert.equal(shares.get(5), 51);
  assert.equal(shares.get(2), 50);
});

// ---- Chips -----------------------------------------------------------------------------

test("poker: pushing chips, exact and with change from the bank", () => {
  // Raise 200 with two 100s: exact.
  const exact = chipsForBet({ 100: 3, 25: 2 }, 200);
  assert.deepEqual(exact.pushed, { 100: 2 });
  assert.deepEqual(exact.change, {});
  // Raise 160 holding only 100s: push two, get 40 back.
  const withChange = chipsForBet({ 100: 3 }, 160);
  assert.deepEqual(withChange.pushed, { 100: 2 });
  assert.equal(stackTotal(withChange.change), 40);
  assert.deepEqual(withChange.change, { 25: 1, 5: 3 });
  // Greedy would fail on 30 from {25:1, 10:3}; the exact search finds three 10s.
  assert.deepEqual(chipsForBet({ 25: 1, 10: 3 }, 30).pushed, { 10: 3 });
  // All-in pushes everything.
  const allIn = chipsForBet({ 5: 3, 1: 4 }, 19);
  assert.deepEqual(allIn.pushed, { 5: 3, 1: 4 });
  assert.equal(stackTotal(makeChange(160)), 160);
  // A 200 stack at 1/2 is racked with small change for blinds.
  const rack = rackStartingStack(200, 2);
  assert.equal(stackTotal(rack), 200);
  assert.ok((rack[1] ?? 0) >= 4, "has ones for the small blind");
});

// ---- Engine ------------------------------------------------------------------------------

/** A deck stacked so we control the outcome: hole cards in deal order, then board after burns. */
function stackedDeck(holeInDealOrder: string, burnsAndBoard: string): Card[] {
  const used = [...parseCards(holeInDealOrder), ...parseCards(burnsAndBoard)];
  const rest = freshDeck().filter((c) => !used.includes(c));
  return [...used, ...rest];
}

const cfg = { smallBlind: 1, bigBlind: 2 };
const seat = (seat: number, chips: number) => ({ seat, name: `P${seat}`, chips: makeChange(chips) });
const stack = (s: HandState, seatNo: number) => stackTotal(s.players.find((p) => p.seat === seatNo)!.chips);

test("poker: blinds, deal order and first to act with three players", () => {
  // Button 0, SB 1, BB 2. Deal order SB, BB, BTN; two rounds.
  const deck = stackedDeck("Ah Kh Qh Ad Kd Qd", "3c 7s 8s 9s 3d Tc 4c Jc");
  const s = startHand(cfg, 1, [seat(0, 200), seat(1, 200), seat(2, 200)], 0, deck);
  assert.equal(s.sbSeat, 1);
  assert.equal(s.bbSeat, 2);
  assert.deepEqual(s.players[1]!.holeCards, parseCards("Ah Ad"));
  assert.deepEqual(s.players[0]!.holeCards, parseCards("Qh Qd"));
  assert.equal(s.toAct, 0, "under the gun is left of the big blind: the button in 3-handed");
  assert.equal(stack(s, 1), 199);
  assert.equal(stack(s, 2), 198);
  assert.equal(s.currentBet, 2);
});

test("poker: heads-up, the button posts the small blind and acts first pre-flop, last after", () => {
  const deck = stackedDeck("Ah Kh Ad Kd", "3c 7s 8s 9s 3d Tc 4c Jc");
  const s = startHand(cfg, 1, [seat(3, 100), seat(7, 100)], 7, deck);
  assert.equal(s.sbSeat, 7);
  assert.equal(s.bbSeat, 3);
  assert.equal(s.toAct, 7, "button acts first pre-flop");
  applyAction(s, 7, { type: "call" });
  // The big blind has the option even though everything is matched.
  assert.equal(s.toAct, 3);
  const la = legalActions(s, 3)!;
  assert.ok(la.canCheck && la.canRaise);
  applyAction(s, 3, { type: "check" });
  assert.equal(s.street, "flop");
  assert.equal(s.toAct, 3, "post-flop the non-button acts first");
});

test("poker: minimum raise follows the last raise size; all-in short raise does not reopen", () => {
  const deck = stackedDeck("2h 3h 4h 5h 6h 7h 8h 9h", "3c 7s 8s 9s 3d Tc 4c Jc");
  // Seats 0..3, button 0, SB 1, BB 2, UTG 3. Seat 3 has only 11 chips.
  const s = startHand(cfg, 1, [seat(0, 200), seat(1, 200), seat(2, 200), seat(3, 11)], 0, deck);
  // UTG (3) opens to 8: a raise of 6 over the 2 blind.
  let la = legalActions(s, 3)!;
  assert.equal(la.minTo, 4, "min raise over a 2 blind is to 4");
  applyAction(s, 3, { type: "raise", to: 8 });
  la = legalActions(s, 0)!;
  assert.equal(la.minTo, 14, "re-raise must be at least 6 more");
  assert.throws(() => applyAction(s, 0, { type: "raise", to: 12 }), /minimum is 14/);
  applyAction(s, 0, { type: "raise", to: 14 });
  // SB folds, BB calls 14.
  applyAction(s, 1, { type: "fold" });
  applyAction(s, 2, { type: "call" });
  // Back to seat 3 who faces 14 with only 3 left (11 total): all-in to 11 is a call for less.
  la = legalActions(s, 3)!;
  assert.ok(la.callIsAllIn);
  applyAction(s, 3, { type: "call" });
  assert.equal(s.street, "flop", "round closed: everyone matched or all-in");

  // Flop: seat 2 bets 20, seat 0 has acted? No: new street. Seat 2 first (left of button).
  assert.equal(s.toAct, 2);
  applyAction(s, 2, { type: "bet", to: 20 });
  applyAction(s, 0, { type: "call" });
  assert.equal(s.street, "turn");
});

test("poker: incomplete all-in raise, the full-bet rule", () => {
  // Button 0, SB 1, BB 2, UTG 3. Seat 2 (BB) has 30 chips total.
  const deck = stackedDeck("2h 3h 4h 5h 6h 7h 8h 9h", "3c 7s 8s 9s 3d Tc 4c Jc");
  const s = startHand(cfg, 1, [seat(0, 200), seat(1, 200), seat(2, 30), seat(3, 200)], 0, deck);
  applyAction(s, 3, { type: "raise", to: 20 }); // UTG opens to 20 (raise of 18)
  applyAction(s, 0, { type: "call" });
  applyAction(s, 1, { type: "fold" });
  // BB goes all-in to 30: only +10 over 20, less than the 18 needed. Legal (all-in) but not a real raise.
  const laBB = legalActions(s, 2)!;
  assert.equal(laBB.maxTo, 30);
  applyAction(s, 2, { type: "raise", to: 30 });
  assert.equal(s.currentBet, 30);
  assert.equal(s.lastRaiseSize, 18, "short all-in does not change the raise size");
  // UTG already acted: may call the extra 10 or fold, not raise.
  const laUTG = legalActions(s, 3)!;
  assert.equal(laUTG.canRaise, false);
  assert.ok(laUTG.bettingNotReopened);
  assert.equal(laUTG.callAmount, 10);
  assert.throws(() => applyAction(s, 3, { type: "raise", to: 60 }), /not reopened/);
  applyAction(s, 3, { type: "call" });
  // Seat 0 likewise.
  assert.equal(legalActions(s, 0)!.canRaise, false);
  applyAction(s, 0, { type: "call" });
  assert.equal(s.street, "flop");
});

test("poker: everyone folds, the winner takes the pot and never shows", () => {
  const deck = stackedDeck("2h 3h 4h 5h 6h 7h", "3c 7s 8s 9s 3d Tc 4c Jc");
  const s = startHand(cfg, 1, [seat(0, 100), seat(1, 100), seat(2, 100)], 0, deck);
  applyAction(s, 0, { type: "raise", to: 6 });
  applyAction(s, 1, { type: "fold" });
  applyAction(s, 2, { type: "fold" });
  assert.equal(s.street, "complete");
  assert.equal(stack(s, 0), 103, "won the blinds, got his own 6 back");
  assert.ok(!s.events.some((e) => e.type === "reveal"));
});

test("poker: all-in run-out reveals cards, side pots paid to the right hands", () => {
  // Button 0 (SB in HU? no, 3 players). Seats 0,1,2; stacks 30, 10, 30 like the textbook case.
  // Hole cards in deal order SB(1), BB(2), BTN(0): seat1 gets Ah Ad (best), seat2 Kh Kd, seat0 2c 3c.
  const deck = stackedDeck("Ah Kh 2c Ad Kd 3c", "5s 7s 8s 9s 6d Ts Jd Qc");
  const s = startHand(cfg, 1, [seat(0, 30), seat(1, 10), seat(2, 30)], 0, deck);
  applyAction(s, 0, { type: "raise", to: 30 }); // button shoves
  applyAction(s, 1, { type: "call" }); // SB all-in for 10
  applyAction(s, 2, { type: "call" }); // BB all-in for 30
  assert.equal(s.street, "complete");
  assert.ok(s.events.some((e) => e.type === "runout"));
  // Board 7 8 9 T J: a straight on the board, everyone plays the board → three-way split.
  // seat 1 is eligible for the main pot only (30), the side pot (40) splits between 0 and 2.
  const main = s.awards.filter((a) => a.potIndex === 0);
  const side = s.awards.filter((a) => a.potIndex === 1);
  assert.equal(main.reduce((a, b) => a + b.amount, 0), 30);
  assert.equal(side.reduce((a, b) => a + b.amount, 0), 40);
  assert.ok(main.some((a) => a.seat === 1));
  assert.ok(!side.some((a) => a.seat === 1), "short stack cannot win the side pot");
  assert.equal(stack(s, 0) + stack(s, 1) + stack(s, 2), 70, "chips are conserved");
});

test("poker: showdown order, mucking and a straight shuffle", () => {
  const rnd = seededRandomInt(42);
  const deck = shuffle(freshDeck(), rnd);
  assert.equal(new Set(deck).size, 52);
  const s = startHand(cfg, 1, [seat(0, 100), seat(1, 100)], 0, deck);
  // Check it down.
  applyAction(s, 0, { type: "call" });
  applyAction(s, 1, { type: "check" });
  for (let i = 0; i < 3; i++) {
    applyAction(s, s.toAct, { type: "check" });
    applyAction(s, s.toAct, { type: "check" });
  }
  assert.equal(s.street, "complete");
  const reveals = s.events.filter((e) => e.type === "reveal");
  assert.ok(reveals.length >= 1, "at least the first to show reveals");
  assert.equal(stack(s, 0) + stack(s, 1), 200);
});

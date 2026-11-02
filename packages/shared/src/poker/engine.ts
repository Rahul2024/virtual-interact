import { type Card } from "./cards";
import { evaluateBest, describeHand, type HandValue } from "./evaluator";
import { computePots, splitPot, type PotLayer } from "./pots";
import { addToStack, chipsForBet, makeChange, removeFromStack, stackTotal, type ChipStack } from "./chips";

/**
 * No-Limit Texas Hold'em, one hand at a time, as a pure state machine.
 * No timers, no network, no randomness: the server hands in a shuffled deck
 * and calls `applyAction`; everything else is deterministic and unit-tested.
 */

export interface PokerConfig {
  smallBlind: number;
  bigBlind: number;
}

export type Street = "preflop" | "flop" | "turn" | "river" | "showdown" | "complete";

export interface SeatIn {
  seat: number;
  name: string;
  chips: ChipStack;
}

export interface HandPlayer {
  seat: number;
  name: string;
  /** Chips behind (not yet bet). */
  chips: ChipStack;
  /** Chips pushed in front of the player this street. */
  front: ChipStack;
  holeCards: Card[];
  folded: boolean;
  allIn: boolean;
  /** Amount bet on the current street. */
  streetContribution: number;
  /** Amount bet in the whole hand (blinds included). */
  totalContribution: number;
  /** Has acted since the last full bet/raise this street. Blinds don't count. */
  acted: boolean;
  /** Set at showdown. */
  hand?: HandValue;
  revealed: boolean;
}

export type Action =
  | { type: "fold" }
  | { type: "check" }
  | { type: "call" }
  /** `to` is the total street contribution after the bet. */
  | { type: "bet"; to: number }
  | { type: "raise"; to: number };

export interface LegalActions {
  seat: number;
  canCheck: boolean;
  canCall: boolean;
  /** Chips you must add to call (may be less than the full difference if that is all you have). */
  callAmount: number;
  callIsAllIn: boolean;
  canBet: boolean;
  canRaise: boolean;
  /** Minimum legal "to" for a bet/raise (already clamped to your stack). */
  minTo: number;
  /** Your whole stack as a "to" value. */
  maxTo: number;
  /** True when the only reason you can't raise is the full-bet rule. */
  bettingNotReopened: boolean;
}

export interface Award {
  seat: number;
  amount: number;
  potIndex: number;
  /** True when this was an uncalled bet returned, not a pot won. */
  returned: boolean;
  hand?: string;
}

export type HandEvent =
  | { type: "blind"; seat: number; kind: "small" | "big"; amount: number; allIn: boolean }
  | { type: "deal"; seats: number[] }
  | {
      type: "action";
      seat: number;
      action: Action["type"];
      /** Chips added this action. */
      amount: number;
      /** Resulting street contribution. */
      to: number;
      allIn: boolean;
      pushed: ChipStack;
      change: ChipStack;
    }
  | { type: "collect"; pots: PotLayer[] }
  | { type: "street"; street: Street; cards: Card[]; burn: Card }
  | { type: "runout" }
  | { type: "reveal"; seat: number; cards: Card[]; hand: string; mustShow: boolean }
  | { type: "award"; awards: Award[] }
  | { type: "complete"; winners: number[] };

export interface HandState {
  config: PokerConfig;
  handNo: number;
  button: number;
  sbSeat: number;
  bbSeat: number;
  players: HandPlayer[];
  deck: Card[];
  deckIndex: number;
  board: Card[];
  burns: Card[];
  street: Street;
  /** Seat to act, or -1 when no one (between streets / hand over). */
  toAct: number;
  currentBet: number;
  lastRaiseSize: number;
  /** Seat of the last bettor/raiser this street, -1 if none. */
  lastAggressor: number;
  /** The river's last aggressor, kept for show order after the street resets. */
  lastAggressorForShow: number;
  /** Collected chips from finished streets. */
  potChips: ChipStack;
  potTotal: number;
  events: HandEvent[];
  awards: Award[];
}

// ---- Helpers ------------------------------------------------------------------

function player(state: HandState, seat: number): HandPlayer {
  const p = state.players.find((x) => x.seat === seat);
  if (!p) throw new Error(`seat ${seat} not in hand`);
  return p;
}

function stackOf(p: HandPlayer): number {
  return stackTotal(p.chips);
}

/** Players still holding cards. */
function inHand(state: HandState): HandPlayer[] {
  return state.players.filter((p) => !p.folded);
}

/** Players who can still make decisions. */
function canAct(p: HandPlayer): boolean {
  return !p.folded && !p.allIn;
}

/** Next seat clockwise from `seat` among the hand's players (wraps). */
function nextSeat(state: HandState, seat: number, pred: (p: HandPlayer) => boolean): number {
  const seats = state.players.map((p) => p.seat).sort((a, b) => a - b);
  const n = seats.length;
  const start = seats.indexOf(seat);
  for (let k = 1; k <= n; k++) {
    const s = seats[(start + k) % n]!;
    if (pred(player(state, s))) return s;
  }
  return -1;
}

/** Push `amount` of chips from behind to the front, making change from the bank if needed. */
function pushChips(p: HandPlayer, amount: number): { pushed: ChipStack; change: ChipStack } {
  if (amount <= 0) return { pushed: {}, change: {} };
  const bet = chipsForBet(p.chips, amount);
  removeFromStack(p.chips, bet.pushed);
  addToStack(p.chips, bet.change);
  // What lands in front equals the bet exactly: the pushed chips that fit, the rest broken from the bank.
  addToStack(p.front, makeChange(amount));
  p.streetContribution += amount;
  p.totalContribution += amount;
  if (stackOf(p) === 0) p.allIn = true;
  return { pushed: bet.pushed, change: bet.change };
}

// ---- Starting a hand ----------------------------------------------------------------

/**
 * Deals a new hand. `seats` are the dealt-in players in seat order (each with
 * chips > 0), `button` is one of their seat numbers, `deck` is already shuffled.
 */
export function startHand(config: PokerConfig, handNo: number, seats: SeatIn[], button: number, deck: Card[]): HandState {
  if (seats.length < 2) throw new Error("need at least two players");
  if (deck.length !== 52) throw new Error("deck must have 52 cards");
  const players: HandPlayer[] = seats
    .slice()
    .sort((a, b) => a.seat - b.seat)
    .map((s) => ({
      seat: s.seat,
      name: s.name,
      chips: { ...s.chips },
      front: {},
      holeCards: [],
      folded: false,
      allIn: false,
      streetContribution: 0,
      totalContribution: 0,
      acted: false,
      revealed: false,
    }));

  const state: HandState = {
    config,
    handNo,
    button,
    sbSeat: -1,
    bbSeat: -1,
    players,
    deck,
    deckIndex: 0,
    board: [],
    burns: [],
    street: "preflop",
    toAct: -1,
    currentBet: 0,
    lastRaiseSize: config.bigBlind,
    lastAggressor: -1,
    lastAggressorForShow: -1,
    potChips: {},
    potTotal: 0,
    events: [],
    awards: [],
  };

  // Blinds. Heads-up: the button is the small blind.
  const headsUp = players.length === 2;
  state.sbSeat = headsUp ? button : nextSeat(state, button, () => true);
  state.bbSeat = nextSeat(state, state.sbSeat, () => true);
  postBlind(state, state.sbSeat, "small", config.smallBlind);
  postBlind(state, state.bbSeat, "big", config.bigBlind);
  // Everyone must match the full big blind even if the BB player was short.
  state.currentBet = config.bigBlind;
  state.lastRaiseSize = config.bigBlind;

  // Deal: one card at a time starting left of the button (SB), button last.
  const dealOrder: number[] = [];
  let s = nextSeat(state, button, () => true);
  for (let i = 0; i < players.length; i++) {
    dealOrder.push(s);
    s = nextSeat(state, s, () => true);
  }
  for (let round = 0; round < 2; round++) {
    for (const seat of dealOrder) player(state, seat).holeCards.push(draw(state));
  }
  state.events.push({ type: "deal", seats: dealOrder });

  // First to act pre-flop: left of the big blind (heads-up that is the button).
  state.toAct = nextSeat(state, state.bbSeat, canAct);
  settleIfNoDecisions(state);
  return state;
}

function postBlind(state: HandState, seat: number, kind: "small" | "big", amount: number) {
  const p = player(state, seat);
  const pay = Math.min(amount, stackOf(p));
  pushChips(p, pay);
  state.events.push({ type: "blind", seat, kind, amount: pay, allIn: p.allIn });
}

function draw(state: HandState): Card {
  const c = state.deck[state.deckIndex];
  if (c === undefined) throw new Error("deck exhausted");
  state.deckIndex++;
  return c;
}

// ---- Legal actions ---------------------------------------------------------------

export function legalActions(state: HandState, seat: number): LegalActions | undefined {
  if (state.toAct !== seat) return undefined;
  const p = player(state, seat);
  if (!canAct(p)) return undefined;
  const stack = stackOf(p);
  const owed = state.currentBet - p.streetContribution;
  const canCheck = owed <= 0;
  const callAmount = Math.min(owed, stack);
  const callIsAllIn = owed > 0 && stack <= owed;
  const maxTo = p.streetContribution + stack;
  const minRaiseTo = state.currentBet + state.lastRaiseSize;
  const minBetTo = state.config.bigBlind;
  const noBetYet = state.currentBet === 0;
  const canBet = noBetYet && stack > 0;
  // You can raise if you have more than a call and either haven't acted since the
  // last full raise, or the current bet is simply the blind you're facing.
  const hasMoreThanCall = stack > Math.max(owed, 0);
  const reopened = !p.acted;
  const canRaise = !noBetYet && hasMoreThanCall && reopened;
  const bettingNotReopened = !noBetYet && hasMoreThanCall && !reopened;
  const minTo = Math.min(noBetYet ? minBetTo : minRaiseTo, maxTo);
  return {
    seat,
    canCheck,
    canCall: owed > 0 && stack > 0,
    callAmount: Math.max(0, callAmount),
    callIsAllIn,
    canBet,
    canRaise,
    minTo,
    maxTo,
    bettingNotReopened,
  };
}

// ---- Applying an action ---------------------------------------------------------------

export function applyAction(state: HandState, seat: number, action: Action): HandEvent[] {
  const start = state.events.length;
  const legal = legalActions(state, seat);
  if (!legal) throw new Error("not your turn");
  const p = player(state, seat);

  switch (action.type) {
    case "fold": {
      p.folded = true;
      p.acted = true;
      state.events.push({ type: "action", seat, action: "fold", amount: 0, to: p.streetContribution, allIn: false, pushed: {}, change: {} });
      break;
    }
    case "check": {
      if (!legal.canCheck) throw new Error("cannot check: there is a bet to you");
      p.acted = true;
      state.events.push({ type: "action", seat, action: "check", amount: 0, to: p.streetContribution, allIn: false, pushed: {}, change: {} });
      break;
    }
    case "call": {
      if (!legal.canCall) throw new Error("nothing to call");
      const { pushed, change } = pushChips(p, legal.callAmount);
      p.acted = true;
      state.events.push({ type: "action", seat, action: "call", amount: legal.callAmount, to: p.streetContribution, allIn: p.allIn, pushed, change });
      break;
    }
    case "bet":
    case "raise": {
      const isBet = action.type === "bet";
      if (isBet && !legal.canBet) throw new Error("cannot bet now");
      if (!isBet && !legal.canRaise) throw new Error(legal.bettingNotReopened ? "betting is not reopened" : "cannot raise now");
      const to = Math.floor(action.to);
      if (to > legal.maxTo) throw new Error("not enough chips");
      const allInTo = to === legal.maxTo;
      if (to < legal.minTo && !allInTo) throw new Error(`minimum is ${legal.minTo}`);
      if (to <= state.currentBet) throw new Error("must exceed the current bet");
      const add = to - p.streetContribution;
      const raiseSize = to - state.currentBet;
      const fullRaise = raiseSize >= state.lastRaiseSize;
      const { pushed, change } = pushChips(p, add);
      if (fullRaise) {
        // A real bet/raise: everyone else gets to act again.
        state.lastRaiseSize = raiseSize;
        for (const o of state.players) if (o.seat !== seat) o.acted = false;
      }
      state.currentBet = to;
      state.lastAggressor = seat;
      p.acted = true;
      state.events.push({ type: "action", seat, action: action.type, amount: add, to, allIn: p.allIn, pushed, change });
      break;
    }
  }

  advance(state, seat);
  return state.events.slice(start);
}

/** After an action: find the next player, or close the street / the hand. */
function advance(state: HandState, lastSeat: number) {
  const live = inHand(state);
  if (live.length === 1) {
    finishHand(state);
    return;
  }
  const next = nextSeat(state, lastSeat, (q) => canAct(q) && (q.streetContribution < state.currentBet || !q.acted));
  if (next !== -1) {
    state.toAct = next;
    return;
  }
  // Street is closed.
  state.toAct = -1;
  nextStreet(state);
}

/** If fewer than two players can still make decisions, run the board out. */
function settleIfNoDecisions(state: HandState) {
  const live = inHand(state);
  const deciders = live.filter(canAct);
  const everyoneMatched = deciders.every((p) => p.streetContribution >= state.currentBet || p.acted);
  if (live.length >= 2 && deciders.length <= 1 && everyoneMatched && state.toAct !== -1) {
    // One player left with chips facing all-ins already covered: nothing to decide.
    const lone = deciders[0];
    if (!lone || lone.streetContribution >= state.currentBet) {
      state.toAct = -1;
      nextStreet(state);
    }
  }
}

function collectFront(state: HandState) {
  for (const p of state.players) {
    addToStack(state.potChips, p.front);
    p.front = {};
    p.streetContribution = 0;
    p.acted = false;
  }
  state.potTotal = state.players.reduce((a, p) => a + p.totalContribution, 0);
  state.events.push({ type: "collect", pots: currentPots(state) });
}

function nextStreet(state: HandState) {
  collectFront(state);
  state.currentBet = 0;
  state.lastRaiseSize = state.config.bigBlind;
  state.lastAggressorForShow = state.lastAggressor;
  state.lastAggressor = -1;

  const live = inHand(state);
  const deciders = live.filter(canAct);
  const runout = deciders.length <= 1;
  if (runout && state.street !== "river") {
    state.events.push({ type: "runout" });
    // Everyone's cards are turned up when no more betting is possible.
    for (const p of live) p.revealed = true;
  }

  const dealStreet = (street: Street, n: number) => {
    const burn = draw(state);
    state.burns.push(burn);
    const cards: Card[] = [];
    for (let i = 0; i < n; i++) cards.push(draw(state));
    state.board.push(...cards);
    state.street = street;
    state.events.push({ type: "street", street, cards, burn });
  };

  if (state.street === "preflop") dealStreet("flop", 3);
  else if (state.street === "flop") dealStreet("turn", 1);
  else if (state.street === "turn") dealStreet("river", 1);
  else {
    showdown(state);
    return;
  }

  if (runout) {
    nextStreet(state);
    return;
  }
  // Post-flop action starts left of the button.
  state.toAct = nextSeat(state, state.button, canAct);
}

function currentPots(state: HandState): PotLayer[] {
  return computePots(
    state.players.map((p) => p.totalContribution),
    state.players.map((p) => p.folded),
  ).map((pot) => ({ amount: pot.amount, eligible: pot.eligible.map((i) => state.players[i]!.seat) }));
}

/** Everyone folded to one player. */
function finishHand(state: HandState) {
  collectFront(state);
  const winner = inHand(state)[0]!;
  const pots = currentPots(state);
  const awards: Award[] = pots.map((pot, i) => ({ seat: winner.seat, amount: pot.amount, potIndex: i, returned: pot.eligible.length === 1 && i > 0 }));
  payAwards(state, awards);
  state.street = "complete";
  state.toAct = -1;
  state.events.push({ type: "award", awards });
  state.events.push({ type: "complete", winners: [winner.seat] });
}

function showdown(state: HandState) {
  state.street = "showdown";
  const live = inHand(state);
  for (const p of live) p.hand = evaluateBest([...p.holeCards, ...state.board]);

  // Show order: last aggressor on the river first, else first player left of the button.
  const first =
    state.lastAggressorForShow !== -1 && !player(state, state.lastAggressorForShow).folded
      ? state.lastAggressorForShow
      : nextSeat(state, state.button, (q) => !q.folded);
  const order: HandPlayer[] = [];
  let s = first;
  for (let i = 0; i < live.length; i++) {
    order.push(player(state, s));
    s = nextSeat(state, s, (q) => !q.folded);
  }

  const pots = currentPots(state);
  const awards: Award[] = [];
  const winnersAll = new Set<number>();
  pots.forEach((pot, i) => {
    const eligible = pot.eligible.map((seat) => player(state, seat));
    if (eligible.length === 1) {
      awards.push({ seat: eligible[0]!.seat, amount: pot.amount, potIndex: i, returned: i > 0 });
      return;
    }
    const best = Math.max(...eligible.map((p) => p.hand!.score));
    const winners = eligible.filter((p) => p.hand!.score === best).map((p) => p.seat);
    const seatCount = Math.max(...state.players.map((p) => p.seat)) + 1;
    for (const [seat, amount] of splitPot(pot.amount, winners, state.button, seatCount)) {
      awards.push({ seat, amount, potIndex: i, returned: false, hand: describeHand(player(state, seat).hand!) });
      winnersAll.add(seat);
    }
  });

  // Reveal: first to show must show; winners must show; others may muck.
  let bestSoFar = -1;
  for (const p of order) {
    const mustShow = p === order[0] || winnersAll.has(p.seat) || p.hand!.score > bestSoFar;
    if (mustShow || p.revealed) {
      p.revealed = true;
      state.events.push({ type: "reveal", seat: p.seat, cards: p.holeCards, hand: describeHand(p.hand!), mustShow });
    }
    bestSoFar = Math.max(bestSoFar, p.hand!.score);
  }

  payAwards(state, awards);
  state.street = "complete";
  state.toAct = -1;
  state.events.push({ type: "award", awards });
  state.events.push({ type: "complete", winners: [...winnersAll] });
}

function payAwards(state: HandState, awards: Award[]) {
  state.awards = awards;
  for (const a of awards) {
    // The dealer colours the pot up into clean chips for the winner.
    addToStack(player(state, a.seat).chips, makeChange(a.amount));
  }
  state.potChips = {};
}

/** Current pot layers for display (main + side pots), by seat. */
export function potsForDisplay(state: HandState): PotLayer[] {
  return currentPots(state);
}

export function handIsOver(state: HandState): boolean {
  return state.street === "complete";
}

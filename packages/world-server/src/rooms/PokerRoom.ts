import { Room, type Client } from "colyseus";
import { StateView } from "@colyseus/schema";
import { createHash, randomBytes, randomInt } from "node:crypto";
import {
  POKER_SEATS,
  applyAction,
  cardToString,
  freshDeck,
  legalActions,
  makeChange,
  potsForDisplay,
  rackStartingStack,
  shuffle,
  stackTotal,
  startHand,
  validateConfig,
  type Action,
  type ChipStack,
  type HandEvent,
  type HandState,
  type PokerActionMessage,
  type PokerBuyInMessage,
  type PokerEventMessage,
  type PokerSitMessage,
  type PokerTableConfig,
  type SeatIn,
} from "@vi/shared/poker";
import { isHexColor, sanitizeName } from "@vi/shared";
import { PokerSeat, PokerTableState } from "./PokerState.js";

/** Pacing of the NPC dealer, in ms. */
const PACE = {
  beforeDeal: 4000,
  afterDeal: 900,
  betweenStreets: 1400,
  afterShowdown: 6000,
  afterFoldWin: 2500,
};

/**
 * One poker table. The dealer is the server: it shuffles with a
 * cryptographic RNG, deals, runs the clock, makes change, announces, and
 * pays. Nobody at the table can influence the cards, including the host,
 * whose only powers are the table settings and pressing Start.
 */
export class PokerRoom extends Room<{ state: PokerTableState }> {
  override maxClients = 40; // players + railbirds
  override autoDispose = true;
  override state = new PokerTableState();

  private hand: HandState | undefined;
  private config: PokerTableConfig = validateConfig({});
  private timer: ReturnType<typeof setTimeout> | undefined;
  private actionTimer: ReturnType<typeof setTimeout> | undefined;
  private seed = "";

  override messages = {
    "poker:sit": (client: Client, m: PokerSitMessage) => this.onSit(client, m),
    "poker:leave": (client: Client) => this.onLeaveSeat(client),
    "poker:buy-in": (client: Client, m: PokerBuyInMessage) => this.onBuyIn(client, m),
    "poker:config": (client: Client, m: Partial<PokerTableConfig>) => this.onConfig(client, m),
    "poker:start": (client: Client) => this.onStart(client),
    "poker:action": (client: Client, m: PokerActionMessage) => this.onAction(client, m),
    "poker:sit-out": (client: Client) => this.setSitOut(client, true),
    "poker:im-back": (client: Client) => this.setSitOut(client, false),
    "poker:show": (client: Client) => this.onShowCards(client),
  };

  override onCreate(options: { tableId?: string; config?: Partial<PokerTableConfig> }): void {
    this.state.tableId = typeof options?.tableId === "string" ? options.tableId.slice(0, 40) : this.roomId;
    this.roomId = this.state.tableId; // one room per table id, joinable by id
    for (let i = 0; i < POKER_SEATS; i++) {
      const s = new PokerSeat();
      s.index = i;
      this.state.seats.push(s);
    }
    this.applyConfig(validateConfig(options?.config ?? {}));
    this.setMetadata({ tableId: this.state.tableId });
  }

  override onJoin(client: Client): void {
    client.view = new StateView();
    if (!this.state.hostSessionId) this.state.hostSessionId = client.sessionId;
  }

  override onLeave(client: Client): void {
    this.onLeaveSeat(client);
    if (this.state.hostSessionId === client.sessionId) {
      // Pass the host role to the first seated player, else the first client.
      const next = this.state.seats.find((s) => !!s.sessionId && s.sessionId !== client.sessionId)?.sessionId ?? this.clients[0]?.sessionId ?? "";
      this.state.hostSessionId = next;
    }
  }

  override onDispose(): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.actionTimer) clearTimeout(this.actionTimer);
  }

  // ---- Lobby --------------------------------------------------------------------------

  private applyConfig(c: PokerTableConfig) {
    this.config = c;
    this.state.smallBlind = c.smallBlind;
    this.state.bigBlind = c.bigBlind;
    this.state.minBuyIn = c.minBuyIn;
    this.state.maxBuyIn = c.maxBuyIn;
    this.state.actionSeconds = c.actionSeconds;
    this.state.practice = c.practice;
  }

  private onConfig(client: Client, m: Partial<PokerTableConfig>) {
    if (client.sessionId !== this.state.hostSessionId) return this.notice(client, "Only the host can change the table.");
    if (this.state.phase !== "lobby") return this.notice(client, "Settings are locked once the game has started.");
    this.applyConfig(validateConfig({ ...this.config, ...m }));
    this.say(`Table set: blinds ${this.config.smallBlind}/${this.config.bigBlind}, buy-in ${this.config.minBuyIn} to ${this.config.maxBuyIn}.`);
  }

  private onSit(client: Client, m: PokerSitMessage) {
    const seat = this.state.seats[m?.seat ?? -1];
    if (!seat) return this.notice(client, "No such seat.");
    if (seat.sessionId) return this.notice(client, "That seat is taken.");
    if (this.seatOf(client)) return this.notice(client, "You're already seated.");
    const buyIn = Math.floor(Number(m.buyIn));
    if (!Number.isFinite(buyIn) || buyIn < this.config.minBuyIn || buyIn > this.config.maxBuyIn) {
      return this.notice(client, `Buy in between ${this.config.minBuyIn} and ${this.config.maxBuyIn}.`);
    }
    seat.sessionId = client.sessionId;
    seat.name = sanitizeName(m.name);
    seat.color = isHexColor(m.color) ? m.color : "#5b8def";
    seat.status = "sitting";
    this.setChips(seat, rackStartingStack(buyIn, this.config.bigBlind));
    seat.front = 0;
    seat.frontChips = "{}";
    seat.totalBet = 0;
    seat.lastAction = "";
    seat.holeCards.clear();
    seat.shownCards.clear();
    client.view!.add(seat);
    this.say(`${seat.name} sits down in seat ${seat.index + 1} with ${buyIn}.`);
    this.maybeScheduleHand();
  }

  private onLeaveSeat(client: Client) {
    const seat = this.seatOf(client);
    if (!seat) return;
    const inHand = this.hand?.players.some((p) => p.seat === seat.index && !p.folded);
    if (inHand && this.hand && this.state.phase !== "showdown") {
      // Leaving mid-hand folds you; your chips in the pot stay.
      try {
        if (this.hand.toAct === seat.index) this.applyAndBroadcast(seat.index, { type: "fold" });
        else {
          const p = this.hand.players.find((x) => x.seat === seat.index)!;
          p.folded = true;
          this.syncFromHand();
        }
      } catch {
        /* hand may have ended */
      }
    }
    const name = seat.name;
    const cash = seat.stack;
    client.view?.remove(seat);
    this.clearSeat(seat);
    this.say(`${name} leaves the table with ${cash}.`);
  }

  private onBuyIn(client: Client, m: PokerBuyInMessage) {
    const seat = this.seatOf(client);
    if (!seat) return this.notice(client, "Sit down first.");
    const amount = Math.floor(Number(m?.amount));
    if (!Number.isFinite(amount) || amount <= 0) return;
    const after = seat.stack + seat.pendingBuyIn + amount;
    if (after > this.config.maxBuyIn) return this.notice(client, `The table max is ${this.config.maxBuyIn}.`);
    const playing = this.hand && this.hand.players.some((p) => p.seat === seat.index && !p.folded) && this.state.phase !== "waiting";
    if (playing) {
      seat.pendingBuyIn += amount;
      this.notice(client, `${amount} more will be added after this hand.`);
    } else {
      this.setChips(seat, this.mergeChips(this.chipsOf(seat), makeChange(amount)));
      if (seat.status === "out" || seat.status === "sitting") seat.status = "sitting";
      this.say(`${seat.name} adds ${amount}.`);
      this.maybeScheduleHand();
    }
  }

  private onStart(client: Client) {
    if (client.sessionId !== this.state.hostSessionId) return this.notice(client, "Only the host starts the game.");
    if (this.state.phase !== "lobby") return;
    if (this.readySeats().length < 2) return this.notice(client, "Need at least two players with chips.");
    this.state.phase = "waiting";
    this.say(`Shuffle up and deal. Blinds ${this.config.smallBlind}/${this.config.bigBlind}. Good luck, everyone.`);
    this.scheduleHand(PACE.beforeDeal / 2);
  }

  private setSitOut(client: Client, out: boolean) {
    const seat = this.seatOf(client);
    if (!seat) return;
    if (out) {
      if (seat.status === "sitting" || seat.status === "out") seat.status = "out";
      else seat.pendingBuyIn = seat.pendingBuyIn; // mid-hand: takes effect next hand via status check
      seat.lastAction = "Sitting out";
      this.say(`${seat.name} is sitting out.`);
    } else {
      if (seat.status === "out") seat.status = "sitting";
      seat.lastAction = "";
      this.say(`${seat.name} is back.`);
      this.maybeScheduleHand();
    }
  }

  private onShowCards(client: Client) {
    const seat = this.seatOf(client);
    if (!seat || !this.hand || this.state.phase !== "showdown") return;
    const p = this.hand.players.find((x) => x.seat === seat.index);
    if (!p || p.revealed) return;
    p.revealed = true;
    seat.shownCards.clear();
    for (const c of p.holeCards) seat.shownCards.push(c);
    seat.shownHand = p.hand ? p.hand.cards.map(cardToString).join(" ") : "";
    this.broadcast("poker:event", { kind: "reveal", seat: seat.index, cards: p.holeCards } satisfies PokerEventMessage);
  }

  // ---- Dealing -------------------------------------------------------------------------

  private readySeats(): PokerSeat[] {
    return this.state.seats.filter((s) => s.sessionId && s.stack > 0 && s.status !== "out");
  }

  private maybeScheduleHand() {
    if (this.state.phase === "waiting" && !this.timer && this.readySeats().length >= 2) this.scheduleHand(PACE.beforeDeal);
  }

  private scheduleHand(ms: number) {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.dealHand();
    }, ms);
  }

  private dealHand() {
    // Apply top-ups and busted/sit-out status between hands.
    for (const s of this.state.seats) {
      if (!s.sessionId) continue;
      if (s.pendingBuyIn > 0) {
        this.setChips(s, this.mergeChips(this.chipsOf(s), makeChange(s.pendingBuyIn)));
        s.pendingBuyIn = 0;
      }
      s.front = 0;
      s.frontChips = "{}";
      s.totalBet = 0;
      s.lastAction = "";
      s.isTurn = false;
      s.holeCards.clear();
      s.shownCards.clear();
      s.shownHand = "";
      if (s.stack === 0 && s.status !== "out") {
        s.status = "sitting";
        s.lastAction = "Needs chips";
      }
    }
    const ready = this.readySeats();
    if (ready.length < 2) {
      this.state.phase = "waiting";
      this.state.street = "";
      this.state.toAct = -1;
      this.say("Waiting for at least two players with chips.");
      return;
    }

    // Button moves to the next ready seat clockwise (simplified moving button).
    const indices = ready.map((s) => s.index).sort((a, b) => a - b);
    const next = indices.find((i) => i > this.state.button) ?? indices[0]!;
    this.state.button = next;

    // Provably fair shuffle: the deck order is derived from a random seed,
    // and sha256(seed:deck) is published before anyone sees a card.
    this.seed = randomBytes(16).toString("hex");
    const deck = shuffle(freshDeck(), seededCrypto(this.seed));
    const deckStr = deck.map(cardToString).join(" ");
    this.state.deckCommitment = createHash("sha256").update(`${this.seed}:${deckStr}`).digest("hex");
    this.state.lastSeed = "";
    this.state.lastDeck = "";

    const seatsIn: SeatIn[] = ready.map((s) => ({ seat: s.index, name: s.name, chips: this.chipsOf(s) }));
    this.state.handNo += 1;
    this.hand = startHand({ smallBlind: this.config.smallBlind, bigBlind: this.config.bigBlind }, this.state.handNo, seatsIn, this.state.button, deck);

    // Hole cards: each owner's view already contains their seat, so only they receive them.
    for (const p of this.hand.players) {
      const s = this.state.seats[p.seat]!;
      s.status = "in";
      for (const c of p.holeCards) s.holeCards.push(c);
    }
    for (const s of this.state.seats) s.isButton = s.index === this.state.button;

    this.state.phase = "dealing";
    this.broadcast("poker:event", { kind: "handStart", handNo: this.state.handNo, commitment: this.state.deckCommitment } satisfies PokerEventMessage);
    this.narrate(this.hand.events.splice(0));
    this.syncFromHand();
    this.say(`Hand #${this.state.handNo}. ${this.seatName(this.hand.sbSeat)} posts ${this.config.smallBlind}, ${this.seatName(this.hand.bbSeat)} posts ${this.config.bigBlind}. Cards are out.`);

    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.hand) return;
      if (this.hand.street === "complete") this.finishHand();
      else this.beginAction();
    }, PACE.afterDeal);
  }

  private beginAction() {
    if (!this.hand) return;
    if (this.hand.toAct === -1) {
      // Street closed by itself (e.g. everyone all-in); engine already dealt on.
      this.afterStreet();
      return;
    }
    this.state.phase = "acting";
    this.syncFromHand();
    const seat = this.state.seats[this.hand.toAct]!;
    const la = legalActions(this.hand, this.hand.toAct)!;
    const owed = la.callAmount;
    this.say(owed > 0 ? `${seat.name}, ${owed} to call.` : `${seat.name}, your action.`);
    this.state.actionDeadline = Date.now() + this.config.actionSeconds * 1000;
    if (this.actionTimer) clearTimeout(this.actionTimer);
    this.actionTimer = setTimeout(() => this.onActionTimeout(this.hand?.toAct ?? -1), this.config.actionSeconds * 1000 + 300);
  }

  private onActionTimeout(seat: number) {
    if (!this.hand || this.hand.toAct !== seat || seat === -1) return;
    const la = legalActions(this.hand, seat);
    if (!la) return;
    const s = this.state.seats[seat]!;
    this.say(`${s.name} ran out of time: ${la.canCheck ? "checks" : "folds"}.`);
    this.applyAndBroadcast(seat, la.canCheck ? { type: "check" } : { type: "fold" });
  }

  private onAction(client: Client, m: PokerActionMessage) {
    const seat = this.seatOf(client);
    if (!seat || !this.hand) return this.notice(client, "You're not in this hand.");
    if (this.state.phase !== "acting" || this.hand.toAct !== seat.index) return this.notice(client, "It's not your turn.");
    const action = m?.action;
    if (!action || typeof action.type !== "string") return;
    try {
      this.applyAndBroadcast(seat.index, action);
    } catch (err) {
      this.notice(client, (err as Error).message);
    }
  }

  private applyAndBroadcast(seat: number, action: Action) {
    if (!this.hand) return;
    const before = this.hand.street;
    const events = applyAction(this.hand, seat, action);
    if (this.actionTimer) clearTimeout(this.actionTimer);
    this.state.actionDeadline = 0;
    this.narrate(events);
    this.syncFromHand();

    if (this.hand.street === "complete") {
      this.finishHand();
      return;
    }
    if (this.hand.street !== before) {
      this.afterStreet();
      return;
    }
    this.beginAction();
  }

  /** A new street was dealt: pause so people can see the cards, then resume. */
  private afterStreet() {
    this.state.phase = "street";
    this.state.toAct = -1;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = undefined;
      if (!this.hand) return;
      if (this.hand.street === "complete") this.finishHand();
      else this.beginAction();
    }, PACE.betweenStreets);
  }

  private finishHand() {
    if (!this.hand) return;
    this.state.phase = "showdown";
    this.state.toAct = -1;
    this.state.actionDeadline = 0;
    // Reveal the seed so anyone can verify the commitment.
    this.state.lastSeed = this.seed;
    this.state.lastDeck = this.hand.deck.map(cardToString).join(" ");
    this.syncFromHand();
    const winners = [...new Set(this.hand.awards.filter((a) => !a.returned).map((a) => a.seat))];
    const total = this.hand.awards.filter((a) => !a.returned).reduce((n, a) => n + a.amount, 0);
    const shown = this.hand.awards.find((a) => a.hand)?.hand;
    this.say(
      winners.length === 1
        ? `${this.seatName(winners[0]!)} wins ${total}${shown ? ` with ${shown.toLowerCase()}` : ""}.`
        : `Split pot: ${winners.map((w) => this.seatName(w)).join(" and ")} share ${total}.`,
    );
    const pause = this.hand.events.some((e) => e.type === "reveal") ? PACE.afterShowdown : PACE.afterFoldWin;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.hand = undefined;
      this.state.phase = "waiting";
      this.dealHand();
    }, pause);
  }

  // ---- Projection: engine → schema ----------------------------------------------------

  private syncFromHand() {
    const h = this.hand;
    if (!h) return;
    this.state.street = h.street;
    this.state.board.clear();
    for (const c of h.board) this.state.board.push(c);
    const pots = potsForDisplay(h);
    this.state.pots = JSON.stringify(pots);
    // Everything committed so far, including the chips still in front of players this street.
    this.state.potTotal = h.players.reduce((n, p) => n + p.totalContribution, 0);
    this.state.toAct = h.toAct;
    this.state.currentBet = h.currentBet;
    const la = h.toAct >= 0 ? legalActions(h, h.toAct) : undefined;
    this.state.minRaiseTo = la?.minTo ?? 0;
    for (const s of this.state.seats) {
      const p = h.players.find((x) => x.seat === s.index);
      s.isTurn = s.index === h.toAct;
      if (!p) continue;
      this.setChips(s, p.chips);
      s.front = p.streetContribution;
      s.frontChips = JSON.stringify(p.front);
      s.totalBet = p.totalContribution;
      s.status = p.folded ? "folded" : p.allIn ? "allin" : "in";
      if (p.revealed && s.shownCards.length === 0) {
        for (const c of p.holeCards) s.shownCards.push(c);
        s.shownHand = p.hand ? p.hand.cards.map(cardToString).join(" ") : "";
      }
    }
  }

  /** Turn engine events into dealer speech and animation messages. */
  private narrate(events: HandEvent[]) {
    for (const e of events) {
      const msg: PokerEventMessage = { kind: e.type as PokerEventMessage["kind"] };
      switch (e.type) {
        case "blind":
          Object.assign(msg, { seat: e.seat, amount: e.amount, allIn: e.allIn, text: `${e.kind} blind ${e.amount}` });
          this.state.seats[e.seat]!.lastAction = `${e.kind === "small" ? "SB" : "BB"} ${e.amount}`;
          break;
        case "deal":
          break;
        case "action": {
          const s = this.state.seats[e.seat]!;
          const verb =
            e.action === "fold"
              ? "folds"
              : e.action === "check"
                ? "checks"
                : e.action === "call"
                  ? `calls ${e.amount}`
                  : e.action === "bet"
                    ? `bets ${e.to}`
                    : `raises to ${e.to}`;
          const changeNote = Object.keys(e.change).length ? ` (${describeChips(e.pushed)} in, ${stackTotal(e.change)} back)` : "";
          const allIn = e.allIn ? " — all in" : "";
          s.lastAction = `${e.action === "fold" ? "Fold" : e.action === "check" ? "Check" : e.action === "call" ? `Call ${e.amount}` : e.action === "bet" ? `Bet ${e.to}` : `Raise ${e.to}`}${e.allIn ? " (all in)" : ""}`;
          Object.assign(msg, { seat: e.seat, action: e.action, amount: e.amount, to: e.to, allIn: e.allIn, pushed: e.pushed, change: e.change, text: `${s.name} ${verb}${changeNote}${allIn}.` });
          this.state.dealerLine = msg.text!;
          break;
        }
        case "collect":
          Object.assign(msg, { pots: e.pots });
          for (const s of this.state.seats) if (s.sessionId) s.lastAction = "";
          break;
        case "street": {
          const names: Record<string, string> = { flop: "Flop", turn: "Turn", river: "River" };
          Object.assign(msg, { street: e.street, cards: e.cards, text: `${names[e.street] ?? e.street}: ${e.cards.map(cardToString).join(" ")}` });
          this.state.dealerLine = msg.text!;
          break;
        }
        case "runout":
          msg.text = "No more betting. Cards up, we'll run it out.";
          this.state.dealerLine = msg.text;
          break;
        case "reveal":
          Object.assign(msg, { seat: e.seat, cards: e.cards, hand: e.hand, text: `${this.seatName(e.seat)} shows ${e.cards.map(cardToString).join(" ")}: ${e.hand}.` });
          break;
        case "award":
          Object.assign(msg, { awards: e.awards });
          break;
        case "complete":
          Object.assign(msg, { winners: e.winners });
          break;
      }
      this.broadcast("poker:event", msg);
    }
  }

  // ---- Small helpers -----------------------------------------------------------------------

  private seatOf(client: Client): PokerSeat | undefined {
    return this.state.seats.find((s) => s.sessionId === client.sessionId);
  }

  private seatName(index: number): string {
    return this.state.seats[index]?.name ?? `Seat ${index + 1}`;
  }

  private chipsOf(seat: PokerSeat): ChipStack {
    try {
      return JSON.parse(seat.chips) as ChipStack;
    } catch {
      return {};
    }
  }

  private setChips(seat: PokerSeat, chips: ChipStack) {
    seat.chips = JSON.stringify(chips);
    seat.stack = stackTotal(chips);
  }

  private mergeChips(a: ChipStack, b: ChipStack): ChipStack {
    const out: ChipStack = { ...a };
    for (const [v, n] of Object.entries(b)) out[Number(v)] = (out[Number(v)] ?? 0) + n;
    return out;
  }

  private clearSeat(seat: PokerSeat) {
    seat.sessionId = "";
    seat.name = "";
    seat.status = "empty";
    seat.stack = 0;
    seat.chips = "{}";
    seat.front = 0;
    seat.frontChips = "{}";
    seat.totalBet = 0;
    seat.lastAction = "";
    seat.holeCards.clear();
    seat.shownCards.clear();
    seat.shownHand = "";
    seat.isButton = false;
    seat.isTurn = false;
    seat.pendingBuyIn = 0;
  }

  private say(text: string) {
    this.state.dealerLine = text;
    this.broadcast("poker:event", { kind: "say", text } satisfies PokerEventMessage);
  }

  private notice(client: Client, text: string) {
    client.send("poker:event", { kind: "say", text } satisfies PokerEventMessage);
  }
}

/** "two 100s" / "a 100 and two 25s" */
function describeChips(chips: ChipStack): string {
  const parts = Object.entries(chips)
    .map(([v, n]) => [Number(v), n] as const)
    .sort((a, b) => b[0] - a[0])
    .map(([v, n]) => `${n === 1 ? "a" : ["", "", "two", "three", "four", "five", "six", "seven", "eight", "nine"][n] ?? n} ${v}${n === 1 ? "" : "s"}`);
  return parts.join(" and ");
}

/**
 * Deterministic random ints from a seed, using SHA-256 in counter mode with
 * rejection sampling, so the published seed reproduces the exact shuffle.
 */
function seededCrypto(seedHex: string): (n: number) => number {
  let counter = 0;
  let buf = Buffer.alloc(0);
  let pos = 0;
  const refill = () => {
    buf = createHash("sha256").update(`${seedHex}:${counter++}`).digest();
    pos = 0;
  };
  return (n: number) => {
    const limit = Math.floor(0x100000000 / n) * n;
    for (;;) {
      if (pos + 4 > buf.length) refill();
      const v = buf.readUInt32BE(pos);
      pos += 4;
      if (v < limit) return v % n;
    }
  };
}

/** Exposed for the hub so a table id can be minted when a player sits at a table in the world. */
export function newTableId(): string {
  return `table-${randomInt(1000, 9999)}`;
}

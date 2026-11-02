import { schema, t, type SchemaType } from "@colyseus/schema";

/**
 * One seat at the table. Everything here is public except `holeCards`, which
 * only the seat's owner receives (Colyseus StateView): other browsers never
 * get the bytes, so there is nothing to peek at.
 */
export const PokerSeat = schema(
  {
    index: t.uint8().default(0),
    sessionId: t.string().default(""),
    name: t.string().default(""),
    color: t.string().default("#5b8def"),
    /** "empty" | "sitting" (waiting for next hand) | "in" | "folded" | "allin" | "out" (sitting out) */
    status: t.string().default("empty" as string),
    /** Chips behind, total value. */
    stack: t.uint32().default(0),
    /** Chips behind, as JSON { "100": 2, "25": 4 }. */
    chips: t.string().default("{}"),
    /** Chips in front this street (value) and their composition. */
    front: t.uint32().default(0),
    frontChips: t.string().default("{}"),
    totalBet: t.uint32().default(0),
    /** Last thing this seat did this street, for the badge: "Raise 160", "Check", "Fold". */
    lastAction: t.string().default(""),
    /** PRIVATE: only this seat's owner sees these two cards. */
    holeCards: t.array("uint8").view(),
    /** Public at showdown (or when the player chooses to show). */
    shownCards: t.array("uint8"),
    /** Dealer's description of the shown hand. */
    shownHand: t.string().default(""),
    isButton: t.boolean().default(false),
    isTurn: t.boolean().default(false),
    /** Pending top-up applied at the next hand. */
    pendingBuyIn: t.uint32().default(0),
  },
  "PokerSeat",
);
export type PokerSeat = SchemaType<typeof PokerSeat>;

export const PokerTableState = schema(
  {
    tableId: t.string().default(""),
    hostSessionId: t.string().default(""),
    phase: t.string().default("lobby" as string),
    // Config (host-set in the lobby)
    smallBlind: t.uint32().default(1),
    bigBlind: t.uint32().default(2),
    minBuyIn: t.uint32().default(100),
    maxBuyIn: t.uint32().default(400),
    actionSeconds: t.uint8().default(25),
    practice: t.boolean().default(true),
    // Live hand
    handNo: t.uint32().default(0),
    button: t.int8().default(-1),
    street: t.string().default("" as string),
    board: t.array("uint8"),
    potTotal: t.uint32().default(0),
    /** JSON [{ amount, eligible: [seat...] }] */
    pots: t.string().default("[]"),
    toAct: t.int8().default(-1),
    /** Epoch ms when the acting player is auto-folded/checked. 0 = no clock. */
    actionDeadline: t.float64().default(0),
    currentBet: t.uint32().default(0),
    minRaiseTo: t.uint32().default(0),
    /** What the NPC dealer just said. */
    dealerLine: t.string().default("Welcome. Take a seat and buy in; the host starts the game."),
    /** Provably fair: hash published before the deal, seed revealed after the hand. */
    deckCommitment: t.string().default(""),
    lastSeed: t.string().default(""),
    lastDeck: t.string().default(""),
    seats: t.array(PokerSeat),
  },
  "PokerTableState",
);
export type PokerTableState = SchemaType<typeof PokerTableState>;

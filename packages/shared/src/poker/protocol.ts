import type { Action } from "./engine";
import type { ChipStack } from "./chips";

/** Room name registered on the world server. One room instance = one table. */
export const POKER_ROOM = "poker";

export const POKER_SEATS = 9;

/** Table settings the host picks in the lobby. */
export interface PokerTableConfig {
  smallBlind: number;
  bigBlind: number;
  minBuyIn: number;
  maxBuyIn: number;
  /** Seconds to act before the dealer checks or folds for you. */
  actionSeconds: number;
  /** Practice aids (hand names, odds) on by default for everyone. */
  practice: boolean;
}

export const DEFAULT_POKER_CONFIG: PokerTableConfig = {
  smallBlind: 1,
  bigBlind: 2,
  minBuyIn: 100,
  maxBuyIn: 400,
  actionSeconds: 25,
  practice: true,
};

export const POKER_MSG = {
  /** client → server */
  sit: "poker:sit",
  leave: "poker:leave",
  buyIn: "poker:buy-in",
  config: "poker:config",
  start: "poker:start",
  action: "poker:action",
  sitOut: "poker:sit-out",
  imBack: "poker:im-back",
  showCards: "poker:show",
  /** server → clients: one animated event (chips moving, card flip, dealer line) */
  event: "poker:event",
} as const;

export interface PokerSitMessage {
  seat: number;
  buyIn: number;
  name?: string;
  color?: string;
}
export interface PokerBuyInMessage {
  amount: number;
}
export interface PokerActionMessage {
  action: Action;
}

/** Table phases as the dealer sees them. */
export type TablePhase = "lobby" | "waiting" | "dealing" | "acting" | "street" | "showdown" | "paused";

/** Shape of an event the client animates; mirrors the engine's HandEvent plus dealer lines. */
export interface PokerEventMessage {
  kind:
    | "say"
    | "blind"
    | "deal"
    | "action"
    | "collect"
    | "street"
    | "runout"
    | "reveal"
    | "award"
    | "complete"
    | "handStart";
  text?: string;
  seat?: number;
  amount?: number;
  to?: number;
  action?: Action["type"];
  allIn?: boolean;
  pushed?: ChipStack;
  change?: ChipStack;
  cards?: number[];
  street?: string;
  pots?: Array<{ amount: number; eligible: number[] }>;
  awards?: Array<{ seat: number; amount: number; potIndex: number; returned: boolean; hand?: string }>;
  hand?: string;
  winners?: number[];
  handNo?: number;
  commitment?: string;
  seed?: string;
}

export function validateConfig(input: Partial<PokerTableConfig>): PokerTableConfig {
  const c = { ...DEFAULT_POKER_CONFIG, ...input };
  const int = (v: unknown, lo: number, hi: number, dflt: number) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : dflt;
  };
  c.bigBlind = int(c.bigBlind, 2, 10_000, 2);
  c.smallBlind = int(c.smallBlind, 1, c.bigBlind, Math.floor(c.bigBlind / 2));
  c.minBuyIn = int(c.minBuyIn, c.bigBlind * 5, 1_000_000, c.bigBlind * 50);
  c.maxBuyIn = int(c.maxBuyIn, c.minBuyIn, 10_000_000, c.minBuyIn * 4);
  c.actionSeconds = int(c.actionSeconds, 10, 120, 25);
  c.practice = Boolean(c.practice);
  return c;
}

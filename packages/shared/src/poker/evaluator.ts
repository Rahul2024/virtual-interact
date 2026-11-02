import { RANK_NAMES, RANK_PLURALS, rankOf, suitOf, type Card } from "./cards";

/** Hand categories, low to high. */
export const HandCategory = {
  HighCard: 0,
  Pair: 1,
  TwoPair: 2,
  Trips: 3,
  Straight: 4,
  Flush: 5,
  FullHouse: 6,
  Quads: 7,
  StraightFlush: 8,
} as const;
export type HandCategory = (typeof HandCategory)[keyof typeof HandCategory];

export interface HandValue {
  category: HandCategory;
  /** Tie-break ranks, most significant first (e.g. trips rank, then kickers). */
  ranks: number[];
  /** The five cards that make the hand, best first. */
  cards: Card[];
  /** Single number: bigger is better. Equal means an exact tie. */
  score: number;
}

/**
 * Evaluates exactly five cards. Suits never break ties; the ace plays low
 * only in the wheel (A-2-3-4-5), which is the lowest straight.
 */
export function evaluate5(cards: Card[]): HandValue {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const suits = cards.map(suitOf);
  const flush = suits.every((s) => s === suits[0]);

  // Straight detection, with the wheel.
  const distinct = [...new Set(ranks)];
  let straightHigh = -1;
  if (distinct.length === 5) {
    if (distinct[0]! - distinct[4]! === 4) straightHigh = distinct[0]!;
    else if (distinct[0] === 12 && distinct[1] === 3 && distinct[4] === 0) straightHigh = 3; // 5-high wheel
  }

  // Group by rank: count desc, then rank desc.
  const counts = new Map<number, number>();
  for (const r of ranks) counts.set(r, (counts.get(r) ?? 0) + 1);
  const groups = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0]);

  let category: HandCategory;
  let tie: number[];
  if (straightHigh >= 0 && flush) {
    category = HandCategory.StraightFlush;
    tie = [straightHigh];
  } else if (groups[0]![1] === 4) {
    category = HandCategory.Quads;
    tie = [groups[0]![0], groups[1]![0]];
  } else if (groups[0]![1] === 3 && groups[1]![1] === 2) {
    category = HandCategory.FullHouse;
    tie = [groups[0]![0], groups[1]![0]];
  } else if (flush) {
    category = HandCategory.Flush;
    tie = ranks;
  } else if (straightHigh >= 0) {
    category = HandCategory.Straight;
    tie = [straightHigh];
  } else if (groups[0]![1] === 3) {
    category = HandCategory.Trips;
    tie = [groups[0]![0], groups[1]![0], groups[2]![0]];
  } else if (groups[0]![1] === 2 && groups[1]![1] === 2) {
    category = HandCategory.TwoPair;
    tie = [groups[0]![0], groups[1]![0], groups[2]![0]];
  } else if (groups[0]![1] === 2) {
    category = HandCategory.Pair;
    tie = [groups[0]![0], groups[1]![0], groups[2]![0], groups[3]![0]];
  } else {
    category = HandCategory.HighCard;
    tie = ranks;
  }

  // Order the five cards for display: grouped cards first, then kickers.
  const ordered = cards.slice().sort((a, b) => {
    const ca = counts.get(rankOf(a))!;
    const cb = counts.get(rankOf(b))!;
    return cb - ca || rankOf(b) - rankOf(a);
  });

  // Pack into one comparable number: category, then up to 5 ranks in base 13.
  let score = category;
  for (let i = 0; i < 5; i++) score = score * 13 + (tie[i] ?? 0);
  return { category, ranks: tie, cards: ordered, score };
}

/** Best five-card hand from 5 to 7 cards. */
export function evaluateBest(cards: Card[]): HandValue {
  if (cards.length < 5) throw new Error("need at least 5 cards");
  if (cards.length === 5) return evaluate5(cards);
  let best: HandValue | undefined;
  const n = cards.length;
  // Choose 5 of n (n ≤ 7 → at most 21 combinations).
  for (let a = 0; a < n - 4; a++)
    for (let b = a + 1; b < n - 3; b++)
      for (let c = b + 1; c < n - 2; c++)
        for (let d = c + 1; d < n - 1; d++)
          for (let e = d + 1; e < n; e++) {
            const v = evaluate5([cards[a]!, cards[b]!, cards[c]!, cards[d]!, cards[e]!]);
            if (!best || v.score > best.score) best = v;
          }
  return best!;
}

export function compareHands(a: HandValue, b: HandValue): number {
  return a.score - b.score;
}

/** "Two pair, Queens and Eights, Ace kicker" — the way a dealer announces it. */
export function describeHand(h: HandValue): string {
  const R = RANK_NAMES;
  const P = RANK_PLURALS;
  const [r0, r1, r2] = h.ranks;
  switch (h.category) {
    case HandCategory.StraightFlush:
      return r0 === 12 ? "Royal flush" : `Straight flush, ${R[r0!]} high`;
    case HandCategory.Quads:
      return `Four of a kind, ${P[r0!]}`;
    case HandCategory.FullHouse:
      return `Full house, ${P[r0!]} full of ${P[r1!]}`;
    case HandCategory.Flush:
      return `Flush, ${R[r0!]} high`;
    case HandCategory.Straight:
      return `Straight, ${R[r0!]} high`;
    case HandCategory.Trips:
      return `Three of a kind, ${P[r0!]}`;
    case HandCategory.TwoPair:
      return `Two pair, ${P[r0!]} and ${P[r1!]}, ${R[r2!]} kicker`;
    case HandCategory.Pair:
      return `Pair of ${P[r0!]}, ${R[r1!]} kicker`;
    default:
      return `${R[r0!]} high`;
  }
}

/** Short form for the HUD: "Two pair", "Flush", ... */
export function shortHandName(h: HandValue): string {
  return ["High card", "Pair", "Two pair", "Three of a kind", "Straight", "Flush", "Full house", "Four of a kind", "Straight flush"][
    h.category
  ]!;
}

/**
 * Cards are small integers 0..51: `rank * 4 + suit`, rank 0 = deuce .. 12 = ace,
 * suit 0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades. Cheap to send, cheap to
 * compare, and the same on the server and in the browser.
 */
export type Card = number;

export const RANK_CHARS = "23456789TJQKA";
export const SUIT_CHARS = "cdhs";
export const SUIT_SYMBOLS = ["♣", "♦", "♥", "♠"] as const;
export const RANK_NAMES = [
  "Two",
  "Three",
  "Four",
  "Five",
  "Six",
  "Seven",
  "Eight",
  "Nine",
  "Ten",
  "Jack",
  "Queen",
  "King",
  "Ace",
] as const;
export const RANK_PLURALS = [
  "Twos",
  "Threes",
  "Fours",
  "Fives",
  "Sixes",
  "Sevens",
  "Eights",
  "Nines",
  "Tens",
  "Jacks",
  "Queens",
  "Kings",
  "Aces",
] as const;

export function rankOf(card: Card): number {
  return card >> 2;
}
export function suitOf(card: Card): number {
  return card & 3;
}
export function makeCard(rank: number, suit: number): Card {
  return rank * 4 + suit;
}

/** "As", "Td", "2c" */
export function cardToString(card: Card): string {
  return RANK_CHARS[rankOf(card)]! + SUIT_CHARS[suitOf(card)]!;
}

export function parseCard(text: string): Card {
  const r = RANK_CHARS.indexOf(text[0]!.toUpperCase());
  const s = SUIT_CHARS.indexOf(text[1]!.toLowerCase());
  if (r < 0 || s < 0) throw new Error(`bad card ${text}`);
  return makeCard(r, s);
}

export function parseCards(text: string): Card[] {
  return text.trim().split(/\s+/).filter(Boolean).map(parseCard);
}

/** A fresh, ordered 52-card deck. Shuffle it with `shuffle()`. */
export function freshDeck(): Card[] {
  const deck: Card[] = [];
  for (let c = 0; c < 52; c++) deck.push(c);
  return deck;
}

/**
 * Fisher–Yates with a caller-supplied random source so the server can use a
 * cryptographic one and tests can use a seeded one. `randomInt(n)` must return
 * a uniform integer in [0, n).
 */
export function shuffle(deck: Card[], randomInt: (n: number) => number): Card[] {
  const out = deck.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    const t = out[i]!;
    out[i] = out[j]!;
    out[j] = t;
  }
  return out;
}

/** Small deterministic PRNG for tests (mulberry32). */
export function seededRandomInt(seed: number): (n: number) => number {
  let s = seed >>> 0;
  return (n: number) => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    const f = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    return Math.floor(f * n);
  };
}

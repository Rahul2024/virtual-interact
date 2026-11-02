export interface PotLayer {
  amount: number;
  /** Seat indices that can win this pot (contributed to it and have not folded). */
  eligible: number[];
}

/**
 * Splits everyone's total contribution for the hand into a main pot and side
 * pots. Folded players' chips stay in the pots they fed but they can win none.
 * A layer with exactly one eligible player is an uncalled bet: it goes
 * straight back to that player at award time.
 *
 * Verified against the textbook case: A 30, B 10 (all-in), C 30 (all-in)
 * → main 30 (A,B,C), side 40 (A,C).
 */
export function computePots(contrib: number[], folded: boolean[]): PotLayer[] {
  const remaining = contrib.slice();
  const pots: PotLayer[] = [];
  for (;;) {
    const live = remaining.map((v, i) => (v > 0 && !folded[i] ? i : -1)).filter((i) => i >= 0);
    if (live.length === 0) break;
    const cap = Math.min(...live.map((i) => remaining[i]!));
    let amount = 0;
    for (let i = 0; i < remaining.length; i++) {
      const take = Math.min(remaining[i]!, cap);
      amount += take;
      remaining[i]! -= take;
    }
    pots.push({ amount, eligible: live });
  }
  // Dead money left over (only folded players still have chips): add to the last pot.
  const dead = remaining.reduce((a, b) => a + b, 0);
  if (dead > 0 && pots.length > 0) pots[pots.length - 1]!.amount += dead;
  return pots;
}

/**
 * Divides one pot between its winners: equal shares, odd chips to the winners
 * nearest clockwise from the button (the button itself is last in that order).
 */
export function splitPot(amount: number, winners: number[], buttonSeat: number, seatCount: number): Map<number, number> {
  const out = new Map<number, number>();
  if (winners.length === 0) return out;
  const share = Math.floor(amount / winners.length);
  let odd = amount - share * winners.length;
  const order = winners.slice().sort((a, b) => clockwiseFrom(buttonSeat, a, seatCount) - clockwiseFrom(buttonSeat, b, seatCount));
  for (const w of order) {
    let v = share;
    if (odd > 0) {
      v += 1;
      odd -= 1;
    }
    out.set(w, v);
  }
  return out;
}

/** 1 for the seat just left of `from`, …, seatCount for `from` itself. */
export function clockwiseFrom(from: number, seat: number, seatCount: number): number {
  const d = (seat - from + seatCount) % seatCount;
  return d === 0 ? seatCount : d;
}

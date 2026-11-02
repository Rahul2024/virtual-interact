/**
 * Physical chips. A stack is a count per denomination. When you bet, you push
 * real chips across the line; if you don't have exact change the dealer makes
 * change from the bank, visibly, like at a live table.
 */

export interface ChipDenom {
  value: number;
  color: string;
  label: string;
}

/** Standard casino colours. Values are what most home games use for 1/2. */
export const CHIP_DENOMS: readonly ChipDenom[] = [
  { value: 1, color: "#f5f5f5", label: "1" },
  { value: 5, color: "#d32f2f", label: "5" },
  { value: 25, color: "#2e7d32", label: "25" },
  { value: 100, color: "#212121", label: "100" },
  { value: 500, color: "#6a1b9a", label: "500" },
  { value: 1000, color: "#f9a825", label: "1000" },
] as const;

/** Chips per denomination value, e.g. { 1: 10, 5: 8, 25: 6 }. */
export type ChipStack = Record<number, number>;

export function stackTotal(stack: ChipStack): number {
  let t = 0;
  for (const [v, n] of Object.entries(stack)) t += Number(v) * n;
  return t;
}

export function addToStack(stack: ChipStack, chips: ChipStack): void {
  for (const [v, n] of Object.entries(chips)) {
    const k = Number(v);
    stack[k] = (stack[k] ?? 0) + n;
    if (stack[k] === 0) delete stack[k];
  }
}

export function removeFromStack(stack: ChipStack, chips: ChipStack): void {
  for (const [v, n] of Object.entries(chips)) {
    const k = Number(v);
    const have = stack[k] ?? 0;
    if (have < n) throw new Error(`not enough ${k} chips`);
    stack[k] = have - n;
    if (stack[k] === 0) delete stack[k];
  }
}

/**
 * Smallest number of chips that make exactly `amount` from the available
 * denominations (bank has unlimited chips). Greedy works because every
 * standard denomination divides the next one up.
 */
export function makeChange(amount: number, denoms: readonly number[] = CHIP_DENOMS.map((d) => d.value)): ChipStack {
  const out: ChipStack = {};
  let left = amount;
  for (const v of denoms.slice().sort((a, b) => b - a)) {
    const n = Math.floor(left / v);
    if (n > 0) {
      out[v] = n;
      left -= n * v;
    }
  }
  if (left !== 0) throw new Error(`cannot make ${amount} from denominations`);
  return out;
}

export interface BetChips {
  /** Chips the player physically pushes forward. */
  pushed: ChipStack;
  /** Chips the dealer hands back from the bank (empty when the push was exact). */
  change: ChipStack;
  /** Total value of pushed minus change: equals the bet amount. */
  amount: number;
}

/**
 * Which chips do you push to bet `amount` from `stack`?
 *
 * Exact-change first (fewest chips, prefers big denominations). If the stack
 * can't make the amount exactly, push the smallest set of chips that covers
 * it and take the difference back as change from the bank: raise 160 holding
 * only 100s → push two 100s, dealer returns 60 (a 25, a 25, two 5s).
 */
export function chipsForBet(stack: ChipStack, amount: number): BetChips {
  const total = stackTotal(stack);
  if (amount > total) throw new Error("bet exceeds stack");
  if (amount === total) return { pushed: { ...stack }, change: {}, amount };

  const denoms = Object.keys(stack)
    .map(Number)
    .sort((a, b) => b - a);

  // 1. Exact: greedy big-to-small limited by what you hold, then verify.
  const exact: ChipStack = {};
  let left = amount;
  for (const v of denoms) {
    const n = Math.min(stack[v]!, Math.floor(left / v));
    if (n > 0) {
      exact[v] = n;
      left -= n * v;
    }
  }
  if (left === 0) return { pushed: exact, change: {}, amount };

  // Greedy can miss exact combos (e.g. 30 from {25:1, 10:3}); try a bounded search.
  const found = exactSubset(stack, denoms, amount);
  if (found) return { pushed: found, change: {}, amount };

  // 2. Overpay with the smallest chip set that covers the amount, change from the bank.
  let best: ChipStack | undefined;
  let bestOver = Infinity;
  let bestCount = Infinity;
  const search = (idx: number, cur: ChipStack, sum: number, count: number) => {
    if (sum >= amount) {
      const over = sum - amount;
      if (over < bestOver || (over === bestOver && count < bestCount)) {
        best = { ...cur };
        bestOver = over;
        bestCount = count;
      }
      return;
    }
    if (idx >= denoms.length) return;
    const v = denoms[idx]!;
    for (let n = stack[v]!; n >= 0; n--) {
      if (n > 0) cur[v] = n;
      else delete cur[v];
      search(idx + 1, cur, sum + n * v, count + n);
      if (bestOver === 0) return;
    }
    delete cur[v];
  };
  search(0, {}, 0, 0);
  const pushed = best!;
  const change = makeChange(stackTotal(pushed) - amount);
  return { pushed, change, amount };
}

function exactSubset(stack: ChipStack, denoms: number[], amount: number): ChipStack | undefined {
  let result: ChipStack | undefined;
  const walk = (idx: number, cur: ChipStack, left: number) => {
    if (result) return;
    if (left === 0) {
      result = { ...cur };
      return;
    }
    if (idx >= denoms.length) return;
    const v = denoms[idx]!;
    const max = Math.min(stack[v]!, Math.floor(left / v));
    for (let n = max; n >= 0; n--) {
      if (n > 0) cur[v] = n;
      else delete cur[v];
      walk(idx + 1, cur, left - n * v);
      if (result) return;
    }
    delete cur[v];
  };
  walk(0, {}, amount);
  return result;
}

/**
 * Starting stack for a buy-in, as a dealer would rack it: a few of the big
 * chips, most of the value in the middle, small change for blinds.
 * 200 at 1/2 → 6×25, 8×5, 10×1.
 */
export function rackStartingStack(buyIn: number, bigBlind: number): ChipStack {
  const denoms = CHIP_DENOMS.map((d) => d.value).filter((v) => v <= buyIn);
  const small = denoms.find((v) => v >= bigBlind / 2) ?? denoms[0]!;
  const out: ChipStack = {};
  let left = buyIn;

  // Small chips: enough for ~5 big blinds.
  const smallCount = Math.min(Math.floor(left / small), Math.max(4, Math.ceil((bigBlind * 5) / small)));
  if (smallCount > 0) {
    out[small] = smallCount;
    left -= smallCount * small;
  }
  // Mid chips (next two denominations up) take about half each of what's left; the rest in bigger chips.
  const mids = denoms.filter((v) => v > small).slice(0, 2);
  for (const v of mids) {
    const n = Math.floor(left / 2 / v);
    if (n > 0) {
      out[v] = (out[v] ?? 0) + n;
      left -= n * v;
    }
  }
  // Whatever is left: largest chips that fit, then fill down.
  addToStack(out, makeChange(left, denoms));
  return out;
}

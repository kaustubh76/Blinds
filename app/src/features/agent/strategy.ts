/**
 * The lender/borrower agents' quoting strategy, in the browser.
 *
 * This is a line-for-line port of `services/admin/src/agents.rs` — the simulated members that quote
 * every window on this desk — so that the Agent page can run the same strategy under your own key and
 * you can watch what changing it does. Where the Rust has a constant, this has a dial with that
 * constant as its default, and the numbers are cited so the two cannot drift silently:
 *
 *   RESTING_TICK = 12                                   agents.rs:77
 *   anchor = (last_r_star_tick + RESTING_TICK) / 2       agents.rs:268
 *   lender  → (Ask, anchor - 3 + rand(5)).clamp(0, 36)   agents.rs:270
 *   borrower → (Bid, anchor + rand(5)).clamp(0, 36)      agents.rs:272
 *   size = (100 + rand(2_000)) * 1_000_000               agents.rs:279
 *   quotes only while open and slot + 3 < start + len    agents.rs:255-258
 *   last_r_star_tick defaults to 12 before a first print agents.rs:150-153
 *
 * Nothing here touches the chain, React or the DOM: it is arithmetic, and it is tested as such.
 */
import { TICKS } from "@thewindow/solana-sdk";

/** The rate quotes revert to. Tick 12 = 4.00 % (100 bp + 25 bp per tick). `agents.rs:77`. */
export const RESTING_TICK = 12;
/** `rand(5)`: the width of the random spread either agent adds. `agents.rs:270,272`. */
export const BAND = 5;
/** How far under the anchor a lender starts before the spread is added. `agents.rs:270`. */
export const LENDER_OFFSET = 3;
/** `100 + rand(2_000)`, in whole USDC. `agents.rs:279`. */
export const SIZE_MIN_USDC = 100;
export const SIZE_SPAN_USDC = 2_000;
/** A bid is three transactions, so the last slots of a window are left alone. `agents.rs:256`. */
export const SLOT_MARGIN = 3;
/** The highest tick on the grid: `TICKS - 1`, which is the 36 the Rust clamps to. */
export const MAX_TICK = TICKS - 1;

export type Side = 0 | 1;
export const ASK: Side = 0;
export const BID: Side = 1;

export interface Dials {
  /** The rate the anchor reverts to. */
  restingTick: number;
  /** The width of the random spread, in ticks. 1 means "no spread". */
  band: number;
  /** How far under the anchor a lender starts. */
  lenderOffset: number;
  sizeMinUsdc: number;
  sizeSpanUsdc: number;
}

export const DEFAULT_DIALS: Dials = {
  restingTick: RESTING_TICK,
  band: BAND,
  lenderOffset: LENDER_OFFSET,
  sizeMinUsdc: SIZE_MIN_USDC,
  sizeSpanUsdc: SIZE_SPAN_USDC,
};

/**
 * The same xorshift64 the Rust agents use (`agents.rs:132-137`), so a seed here and a seed there
 * walk the same sequence. Returns whole numbers in `[0, n)`.
 */
export function xorshift(seed: number | bigint): (n: number) => number {
  // A zero state is a fixed point for xorshift; the Rust seeds from the wallet, which is never zero.
  let s = BigInt(seed) & 0xffff_ffff_ffff_ffffn;
  if (s === 0n) s = 0x2545_f491_4f6c_dd1dn;
  const mask = 0xffff_ffff_ffff_ffffn;
  return (n: number) => {
    s ^= (s << 13n) & mask;
    s ^= s >> 7n;
    s ^= (s << 17n) & mask;
    s &= mask;
    return n <= 0 ? 0 : Number(s % BigInt(n));
  };
}

/** `(lastRStarTick + restingTick) / 2`, truncated as the Rust's integer division is. */
export function anchorTick(lastRStarTick: number | null, restingTick = RESTING_TICK): number {
  const last = lastRStarTick ?? restingTick;
  return Math.trunc((last + restingTick) / 2);
}

const clamp = (n: number) => Math.max(0, Math.min(MAX_TICK, n));

export interface Quote {
  side: Side;
  tick: number;
  sizeMicroUsdc: bigint;
  /** What the quote was built around, so the page can show the reasoning rather than a number. */
  anchor: number;
}

/**
 * One quote. `rand(n)` is the whole-number generator — pass `xorshift(seed)` for a reproducible run,
 * or a stub in a test.
 */
export function quoteFor(side: Side, lastRStarTick: number | null, dials: Dials, rand: (n: number) => number): Quote {
  const anchor = anchorTick(lastRStarTick, dials.restingTick);
  const spread = rand(Math.max(1, Math.trunc(dials.band)));
  const tick = clamp(side === ASK ? anchor - dials.lenderOffset + spread : anchor + spread);
  const usdc = Math.max(1, Math.trunc(dials.sizeMinUsdc)) + rand(Math.max(1, Math.trunc(dials.sizeSpanUsdc)));
  return { side, tick, sizeMicroUsdc: BigInt(usdc) * 1_000_000n, anchor };
}

export interface WindowView {
  /** Whether the auction config says an epoch is open. */
  open: boolean;
  slot: number | null;
  startSlot: number | null;
  epochSlots: number | null;
}

export type Blocked = "no window is open" | "too late in this window" | "the slot is not known yet";

/**
 * Whether there is time to seal a bid: the window is open and the margin still fits.
 * `null` means go; a string is the reason not to, in words the page can print.
 */
export function blockedReason(w: WindowView, margin = SLOT_MARGIN): Blocked | null {
  if (!w.open) return "no window is open";
  if (w.slot === null || w.startSlot === null || w.epochSlots === null) return "the slot is not known yet";
  return w.slot + margin < w.startSlot + w.epochSlots ? null : "too late in this window";
}

/** How the page explains a quote in one line. */
export function explain(q: Quote, dials: Dials, lastRStarTick: number | null): string {
  const from = lastRStarTick === null ? `no print yet, so ${dials.restingTick}` : `last print ${lastRStarTick}`;
  const sideWord = q.side === ASK ? "lend" : "borrow";
  const arm = q.side === ASK ? `− ${dials.lenderOffset} + spread` : "+ spread";
  return `anchor ${q.anchor} = (${from} + resting ${dials.restingTick}) / 2, then ${sideWord} at anchor ${arm} → tick ${q.tick}`;
}

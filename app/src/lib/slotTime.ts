import { config } from "../config";

/**
 * Seconds per slot, measured — not assumed. Devnet ran at 0.44–0.55 s/slot through mid-September 2026
 * and at ~0.17 s/slot from 22 September; every on-chain limit in this desk is a slot count, so a fixed
 * factor turns "9 min" into "3.4 min" without anyone noticing. `useEstimatedSlot` (useWindowClock.ts)
 * feeds the measurement here; everything that turns slots into time reads it.
 *
 * The default only applies until a measurement lands, so it is the cluster's current pace rather than a
 * neutral guess: 0.45 s was 2.6x devnet's real pace, which made every limit on screen read far longer
 * than it is. A large slot delta is never rendered as wall time at all — see the posted-age stats, which
 * print the slot count the chain compares against, because the pace changed under those deltas.
 */
export const SLOT_SECONDS_DEFAULT = config.cluster === "devnet" ? 0.17 : 0.4;
export const SLOT_SECONDS_MIN = 0.1;
export const SLOT_SECONDS_MAX = 1.0;

let rate = SLOT_SECONDS_DEFAULT;
const listeners = new Set<() => void>();

export const slotSeconds = (): number => rate;

/** Record a measured rate (clamped to what a Solana cluster can plausibly run at). */
export function setSlotSeconds(observed: number): void {
  const next = Math.min(SLOT_SECONDS_MAX, Math.max(SLOT_SECONDS_MIN, observed));
  if (next === rate) return;
  rate = next;
  for (const l of listeners) l();
}

export const slotsToSecs = (slots: number): number => Math.max(0, Math.round(slots * rate));
export const secsToSlots = (secs: number): number => secs / rate;

/** For hooks that want to re-render when the rate moves. */
export function subscribeSlotSeconds(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

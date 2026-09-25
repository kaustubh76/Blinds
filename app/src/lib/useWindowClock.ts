/**
 * The window clock: one place that turns chain state into "where are we in the epoch".
 *
 * Numbers come from polls (every SLOT_MS). Between polls the ring keeps moving on a local slot
 * estimate advanced at the measured slot rate, so the clock reads as alive on a 10-second poll —
 * the estimate only ever snaps *forward* and is used for motion, never for a figure.
 */

import type { auction, oracle } from "@thewindow/solana-sdk";
import { EpochStatus, PrintStatus } from "@thewindow/solana-sdk";
import { useEffect, useMemo, useSyncExternalStore } from "react";
import { backdrop } from "./backdrop";
import type { PulseKind } from "./backdropField";
import { devConsole } from "./console";
import { useAuctionConfig, useEpoch, usePrint, useSlot } from "./queries";
import { SLOT_SECONDS_DEFAULT, SLOT_SECONDS_MAX, SLOT_SECONDS_MIN, setSlotSeconds, slotsToSecs } from "./slotTime";

export type Phase = "loading" | "open" | "overdue" | "closed" | "printing" | "printed" | "notrade" | "idle";

export interface Clock {
  phase: Phase;
  epoch: bigint | null;
  /** 0–1 through the open window (1 once closed). */
  progress: number;
  secondsLeft: number | null;
  bids: number;
  attested: number;
  nonzero: number;
  rStar: number | null;
  matched: bigint | null;
  /** Estimated current slot (interpolated between polls). */
  slot: number | null;
}

type Epoch = auction.Epoch;
type Print = oracle.Print;

export function popcount(bytes: ArrayLike<number>): number {
  let n = 0;
  for (let i = 0; i < bytes.length; i++) {
    let b = bytes[i] ?? 0;
    while (b) {
      n += b & 1;
      b >>= 1;
    }
  }
  return n;
}

/** Pure: the phase and figures for a given chain snapshot. */
export function derivePhase(args: {
  hasOpenEpoch: boolean;
  currentEpoch: bigint | null;
  epoch: Epoch | null;
  print: Print | null;
  epochSlots: number;
  slot: number | null;
  /** The config has not arrived yet: nothing is known, not even whether a window exists. */
  loading?: boolean;
}): Omit<Clock, "slot"> {
  const { epoch, print, epochSlots, slot } = args;
  const none = {
    epoch: args.currentEpoch,
    progress: 0,
    secondsLeft: null,
    bids: 0,
    attested: 0,
    nonzero: 0,
    rStar: null,
    matched: null,
  };
  if (args.loading) return { phase: "loading", ...none };
  if (!epoch) return { phase: "idle", ...none };
  const start = Number(epoch.startSlot);
  const closeAt = start + epochSlots;
  if (epoch.status === EpochStatus.Open) {
    const at = slot ?? start;
    const progress = Math.min(1, Math.max(0, (at - start) / epochSlots));
    // Past its close slot and still open: the keeper has not closed it (the market is paused).
    const overdue = slot !== null && slot > closeAt + 30;
    return {
      phase: overdue ? "overdue" : "open",
      ...none,
      epoch: epoch.index,
      progress,
      secondsLeft: slot === null ? null : slotsToSecs(closeAt - slot),
      bids: epoch.totalBids,
    };
  }
  const bids = epoch.totalBids;
  if (!print || print.status === PrintStatus.Attesting) {
    return {
      phase: print ? "printing" : "closed",
      ...none,
      epoch: epoch.index,
      progress: 1,
      bids,
      attested: print?.attested ?? 0,
      nonzero: print ? popcount(print.nonzeroBitmap) : 0,
    };
  }
  // A print stays on the ring until the keeper opens the next window: it is the most informative
  // state the market has, and on a 10-second poll a short-lived stamp would rarely be seen.
  if (print.status === PrintStatus.NoTrade)
    return { phase: "notrade", ...none, epoch: epoch.index, progress: 1, bids, attested: print.attested };
  return {
    phase: "printed",
    ...none,
    epoch: epoch.index,
    progress: 1,
    bids,
    attested: print.attested,
    nonzero: popcount(print.nonzeroBitmap),
    rStar: print.status === PrintStatus.Printed ? print.rStarTick : null,
    matched: print.matchedVolume,
  };
}

export interface TransitionNote {
  /** `epoch:phase`, the identity of this transition. */
  key: string;
  /** The first transition of the page load, not a change the visitor watched happen. */
  first: boolean;
  pulse: PulseKind | null;
}

/**
 * What a phase transition should announce, if anything. Pure, so the dedupe is testable — it used to
 * live in a `useRef`, which meant every mounted clock announced the same transition again.
 */
export function transitionNote(clock: Clock, prevKey: string): TransitionNote | null {
  if (clock.phase === "loading") return null;
  // An open window with no slot yet is not a phase we know; wait for the first slot poll.
  if (clock.phase === "open" && clock.slot === null) return null;
  const key = `${clock.epoch?.toString() ?? "-"}:${clock.phase}`;
  if (key === prevKey) return null;
  const first = prevKey === "";
  const pulse: PulseKind | null =
    clock.phase === "printed" ? "print" : clock.phase === "open" && !first ? "event" : null;
  return { key, first, pulse };
}

/** The last transition announced, for the page rather than for one component. */
let lastTransition = "";

/**
 * The slot estimate, owned by this module rather than by whichever components happen to be mounted.
 *
 * Several components call `useWindowClock()` at once — the header pill, the backdrop, and the route
 * itself. Each used to keep its own EMA in a ref and race the others to write `setSlotSeconds`, so a
 * freshly mounted route dragged the shared rate from the measured ~0.17 back toward the 0.45 default
 * and held it there for a minute and a half. That rate is what every slots→time figure on the page
 * is rendered through (`slotTime.ts` says exactly why that matters), so the race was showing wrong
 * times, not just wrong motion. One estimator, one writer, one answer — and every caller now reads
 * the same slot, so two countdowns on one page can no longer disagree.
 */
let estimate: { base: number; at: number; rate: number } | null = null;
let estimated: number | null = null;
let lastPolled: number | null = null;
let missed = 0;
const slotListeners = new Set<() => void>();
let slotLoopStarted = false;

const readSlot = (): number | null => estimated;
const subscribeSlot = (l: () => void) => {
  slotListeners.add(l);
  return () => {
    slotListeners.delete(l);
  };
};

function publishSlot(next: number | null): void {
  if (next === estimated) return;
  estimated = next;
  for (const l of slotListeners) l();
}

/**
 * Consecutive polls the extrapolation may fail to measure before we stop believing it.
 *
 * Between polls the estimate is a guess; the poll is the truth. The rate is only re-measured when the
 * poll has passed the guess (`polled > prev.base`), and the guess only ever moves forward — so if the
 * guess ever gets far enough ahead of the chain, that test is false **for good**: the rate freezes,
 * the guess keeps running, and the gap widens on every poll. A restarted or rolled-back validator
 * does it instantly (the chain returns to a low slot while the guess is at half a million), and a tab
 * left hidden long enough does it slowly. The symptom is not subtle — `derivePhase` calls the window
 * `overdue`, every countdown reads zero, and the measured slot rate that every slots→time figure on
 * the page is rendered through is frozen wrong — and nothing but a reload recovers.
 *
 * In a healthy market the poll passes the guess every single time, so three misses in a row is not a
 * close call: it means the guess has lost the chain. Throw it away and start again from the poll.
 */
const MISSES_BEFORE_RESEED = 3;

/** Folds one poll into the estimator. Repeating the same slot is a no-op, so N callers cost one. */
export function recordPolledSlot(polled: number): void {
  if (polled === lastPolled) return;
  lastPolled = polled;
  const now = performance.now();
  const prev = estimate;
  let rate = prev?.rate ?? SLOT_SECONDS_DEFAULT;
  if (prev && polled > prev.base) {
    const observed = (now - prev.at) / 1000 / (polled - prev.base);
    rate = Math.min(SLOT_SECONDS_MAX, Math.max(SLOT_SECONDS_MIN, prev.rate * 0.7 + observed * 0.3));
    setSlotSeconds(rate); // every slot→time conversion on the page follows the measurement
    missed = 0;
  } else if (prev && ++missed >= MISSES_BEFORE_RESEED) {
    // Keep the rate — it was measured on this cluster and is still the best figure we have — but
    // re-seed the position from the chain rather than from a guess that has run away from it.
    missed = 0;
    estimate = { base: polled, at: now, rate };
    publishSlot(polled);
    return;
  }
  // Snap forward only: a poll that is behind our estimate must not rewind the ring.
  const base = Math.max(polled, prev ? prev.base + (now - prev.at) / 1000 / prev.rate : polled);
  estimate = { base, at: now, rate };
  publishSlot(Math.floor(base));
}

/** The published estimate, for code that is not in a render — the tests that pin this behaviour. */
export const estimatedSlot = (): number | null => estimated;

/** Forgets the measurement. For tests, which must not inherit the previous one's estimator. */
export function resetSlotEstimate(): void {
  estimate = null;
  lastPolled = null;
  missed = 0;
  publishSlot(null);
}

/**
 * One loop for the page, started on first use and never torn down — the same bargain `useLive.ts`
 * makes with its subscription, and for the same reason: it outlives React's StrictMode double-mount.
 * It stops while the tab is hidden; the next poll snaps the estimate forward on return.
 */
function startSlotLoop(): void {
  if (slotLoopStarted || typeof window === "undefined") return;
  slotLoopStarted = true;
  let raf = 0;
  let last = 0;
  const tick = (t: number) => {
    raf = requestAnimationFrame(tick);
    if (t - last < 250 || !estimate) return; // ~4 updates/s is plenty for a ring
    last = t;
    const { base, at, rate } = estimate;
    publishSlot(Math.floor(base + (t - at) / 1000 / rate));
  };
  const start = () => {
    if (raf) return;
    last = 0;
    raf = requestAnimationFrame(tick);
  };
  const stop = () => {
    if (!raf) return;
    cancelAnimationFrame(raf);
    raf = 0;
  };
  document.addEventListener("visibilitychange", () => (document.hidden ? stop() : start()));
  if (!document.hidden) start();
}

/** The shared slot estimate, advanced between polls at the measured rate; never goes backwards. */
export function useEstimatedSlot(polled: number | undefined): number | null {
  useEffect(startSlotLoop, []);
  useEffect(() => {
    if (polled !== undefined) recordPolledSlot(polled);
  }, [polled]);
  return useSyncExternalStore(subscribeSlot, readSlot, readSlot);
}

export function useWindowClock(): Clock {
  const cfg = useAuctionConfig();
  const current = cfg.data?.currentEpoch ?? null;
  const epoch = useEpoch(current);
  const print = usePrint(current);
  const slotQ = useSlot();
  const slot = useEstimatedSlot(slotQ.data);
  const clock = useMemo(() => {
    const d = derivePhase({
      hasOpenEpoch: cfg.data?.hasOpenEpoch ?? false,
      currentEpoch: current,
      epoch: epoch.data ?? null,
      print: print.data ?? null,
      epochSlots: Number(cfg.data?.epochSlots ?? 0) || 1,
      slot,
      loading: cfg.data === undefined || (current !== null && epoch.data === undefined),
    });
    return { ...d, slot };
  }, [cfg.data, current, epoch.data, print.data, slot]);
  // Phase transitions are chain facts worth a line in the developer console — one line, however many
  // clocks are mounted, which is why the key lives in the module and not in a ref.
  useEffect(() => {
    const note = transitionNote(clock, lastTransition);
    if (!note) return;
    lastTransition = note.key;
    // The market's own moments reach the backdrop from here, once.
    if (note.pulse) backdrop.pulse(note.pulse);
    devConsole.push({
      kind: "chain",
      title: `epoch ${clock.epoch?.toString() ?? "—"} → ${clock.phase}${note.first ? " (on load)" : ""}`,
      detail: {
        bids: clock.bids,
        attested: clock.attested,
        nonzero: clock.nonzero,
        rStar: clock.rStar,
        matched: clock.matched,
        slot: clock.slot,
      },
    });
  }, [clock]);
  return clock;
}

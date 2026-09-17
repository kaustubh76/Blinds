/**
 * The window clock: one place that turns chain state into "where are we in the epoch".
 *
 * Numbers come from polls (every SLOT_MS). Between polls the ring keeps moving on a local slot
 * estimate advanced at the measured slot rate, so the clock reads as alive on a 10-second poll —
 * the estimate only ever snaps *forward* and is used for motion, never for a figure.
 */

import type { auction, oracle } from "@thewindow/solana-sdk";
import { EpochStatus, PrintStatus } from "@thewindow/solana-sdk";
import { useEffect, useMemo, useRef, useState } from "react";
import { devConsole } from "./console";
import { useAuctionConfig, useEpoch, usePrint, useSlot } from "./queries";

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
      secondsLeft: slot === null ? null : Math.max(0, Math.round((closeAt - slot) * 0.45)),
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

const SLOT_SECONDS_DEFAULT = 0.45;
const SLOT_SECONDS_MIN = 0.35;
const SLOT_SECONDS_MAX = 0.7;

/** Advances a slot estimate between polls at the measured slot rate; never goes backwards. */
export function useEstimatedSlot(polled: number | undefined): number | null {
  const [est, setEst] = useState<number | null>(null);
  const ref = useRef<{ base: number; at: number; rate: number } | null>(null);
  useEffect(() => {
    if (polled === undefined) return;
    const now = performance.now();
    const prev = ref.current;
    let rate = prev?.rate ?? SLOT_SECONDS_DEFAULT;
    if (prev && polled > prev.base) {
      const observed = (now - prev.at) / 1000 / (polled - prev.base);
      rate = Math.min(SLOT_SECONDS_MAX, Math.max(SLOT_SECONDS_MIN, prev.rate * 0.7 + observed * 0.3));
    }
    // Snap forward only: a poll that is behind our estimate must not rewind the ring.
    const base = Math.max(polled, prev ? prev.base + (now - prev.at) / 1000 / prev.rate : polled);
    ref.current = { base, at: now, rate };
    setEst(Math.floor(base));
  }, [polled]);
  useEffect(() => {
    let raf = 0;
    let last = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      if (t - last < 250 || !ref.current) return; // ~4 updates/s is plenty for a ring
      last = t;
      const { base, at, rate } = ref.current;
      setEst(Math.floor(base + (t - at) / 1000 / rate));
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return est;
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
  // Phase transitions are chain facts worth a line in the developer console.
  const last = useRef<string>("");
  useEffect(() => {
    if (clock.phase === "loading") return;
    const key = `${clock.epoch?.toString() ?? "-"}:${clock.phase}`;
    if (key === last.current) return;
    const first = last.current === "";
    last.current = key;
    devConsole.push({
      kind: "chain",
      title: `epoch ${clock.epoch?.toString() ?? "—"} → ${clock.phase}${first ? " (on load)" : ""}`,
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

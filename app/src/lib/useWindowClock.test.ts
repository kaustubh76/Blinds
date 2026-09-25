import type { auction, oracle } from "@thewindow/solana-sdk";
import { EpochStatus, PrintStatus } from "@thewindow/solana-sdk";
import { beforeEach, describe, expect, it } from "vitest";
import { SLOT_SECONDS_DEFAULT, setSlotSeconds, slotSeconds } from "./slotTime";
import {
  type Clock,
  derivePhase,
  estimatedSlot,
  popcount,
  recordPolledSlot,
  resetSlotEstimate,
  transitionNote,
} from "./useWindowClock";

const epoch = (over: Partial<auction.Epoch>): auction.Epoch =>
  ({ index: 7n, startSlot: 1_000n, closeSlot: 0n, status: EpochStatus.Open, totalBids: 3, ...over }) as auction.Epoch;
const print = (over: Partial<oracle.Print>): oracle.Print =>
  ({
    status: PrintStatus.Attesting,
    attested: 0,
    nonzeroBitmap: new Uint8Array(10),
    rStarTick: 0,
    matchedVolume: 0n,
    finalizedSlot: 0n,
    ...over,
  }) as oracle.Print;
const base = { hasOpenEpoch: true, currentEpoch: 7n, epochSlots: 900 };

describe("window clock", () => {
  it("counts bits", () => {
    expect(popcount(new Uint8Array([0b1011, 0b1]))).toBe(4);
  });

  it("open: progress and seconds left follow the slot", () => {
    const c = derivePhase({ ...base, epoch: epoch({}), print: null, slot: 1_450 });
    expect(c.phase).toBe("open");
    expect(c.progress).toBeCloseTo(0.5);
    expect(c.secondsLeft).toBe(Math.round(450 * 0.45));
    expect(c.bids).toBe(3);
  });

  it("open past the close slot caps at 1 and 0 seconds", () => {
    const c = derivePhase({ ...base, epoch: epoch({}), print: null, slot: 2_500 });
    expect(c.progress).toBe(1);
    expect(c.secondsLeft).toBe(0);
  });

  it("closed without a print, then printing with proven/nonzero", () => {
    const closed = epoch({ status: EpochStatus.Closed, closeSlot: 1_900n });
    expect(derivePhase({ ...base, hasOpenEpoch: false, epoch: closed, print: null, slot: 1_950 }).phase).toBe("closed");
    const nz = new Uint8Array(10);
    nz[0] = 0b111;
    nz[5] = 0b11;
    const c = derivePhase({
      ...base,
      hasOpenEpoch: false,
      epoch: closed,
      print: print({ nonzeroBitmap: nz, attested: 4 }),
      slot: 1_950,
    });
    expect(c.phase).toBe("printing");
    expect(c.attested).toBe(4);
    expect(c.nonzero).toBe(5);
  });

  /**
   * Devnet sat closed-and-unprinted for four days while the front page said a print was about to
   * happen. The deadline is the chain's own: `mark_stale` is accepted past
   * `closeSlot + stale_after_slots`, so that is exactly where the ring stops implying imminence.
   */
  it("a closed epoch nobody printed goes from closed to stalled at the chain's own deadline", () => {
    const closed = epoch({ status: EpochStatus.Closed, closeSlot: 1_900n });
    const at = (slot: number, staleAfterSlots?: number) =>
      derivePhase({
        ...base,
        hasOpenEpoch: false,
        epoch: closed,
        print: null,
        slot,
        ...(staleAfterSlots === undefined ? {} : { staleAfterSlots }),
      }).phase;

    // Just closed: a print really is next.
    expect(at(1_950, 450)).toBe("closed");
    // One slot short of the deadline, and then on it.
    expect(at(2_349, 450)).toBe("closed");
    expect(at(2_350, 450)).toBe("stalled");
    // Four days later, which is what the hosted site was showing.
    expect(at(2_800_000, 450)).toBe("stalled");
  });

  it("without the oracle's deadline, one more whole window is the benefit of the doubt", () => {
    const closed = epoch({ status: EpochStatus.Closed, closeSlot: 1_900n });
    const at = (slot: number) => derivePhase({ ...base, hasOpenEpoch: false, epoch: closed, print: null, slot }).phase;
    expect(at(2_700)).toBe("closed"); // 800 slots past, inside the 900-slot fallback
    expect(at(2_801)).toBe("stalled");
  });

  it("a print in progress is never stalled, however long it has taken", () => {
    const closed = epoch({ status: EpochStatus.Closed, closeSlot: 1_900n });
    const attesting = print({ status: PrintStatus.Attesting, attested: 2 });
    expect(derivePhase({ ...base, hasOpenEpoch: false, epoch: closed, print: attesting, slot: 9_000_000 }).phase).toBe(
      "printing",
    );
  });

  it("printed keeps r* on the ring until the next window opens", () => {
    const done = epoch({ status: EpochStatus.Printed, closeSlot: 1_900n });
    const p = print({
      status: PrintStatus.Printed,
      rStarTick: 19,
      matchedVolume: 901_000_000n,
      finalizedSlot: 1_960n,
      attested: 4,
    });
    const fresh = derivePhase({ ...base, hasOpenEpoch: false, epoch: done, print: p, slot: 1_980 });
    expect(fresh.phase).toBe("printed");
    expect(fresh.rStar).toBe(19);
    expect(fresh.matched).toBe(901_000_000n);
    expect(derivePhase({ ...base, hasOpenEpoch: false, epoch: done, print: p, slot: 9_999 }).phase).toBe("printed");
  });

  it("no trade is its own phase", () => {
    const e = epoch({ status: EpochStatus.NoTrade, closeSlot: 1_900n });
    const p = print({ status: PrintStatus.NoTrade, finalizedSlot: 1_960n });
    expect(derivePhase({ ...base, hasOpenEpoch: false, epoch: e, print: p, slot: 1_970 }).phase).toBe("notrade");
  });

  it("no epoch at all is idle", () => {
    expect(derivePhase({ ...base, epoch: null, print: null, slot: 5 }).phase).toBe("idle");
  });
});

const clock = (over: Partial<Clock>): Clock =>
  ({
    phase: "open",
    epoch: 7n,
    progress: 0.5,
    secondsLeft: 60,
    bids: 3,
    attested: 0,
    nonzero: 0,
    rStar: null,
    matched: null,
    slot: 1_500,
    ...over,
  }) as Clock;

describe("transitionNote", () => {
  it("says nothing while loading, or before the first slot of an open window", () => {
    expect(transitionNote(clock({ phase: "loading" }), "")).toBeNull();
    expect(transitionNote(clock({ phase: "open", slot: null }), "")).toBeNull();
  });

  // The key used to live in a `useRef`, so every mounted clock announced the same transition again —
  // two or three console lines and two or three backdrop pulses for one fact.
  it("announces a transition once, however many callers ask", () => {
    const c = clock({ phase: "printed", epoch: 7n });
    const first = transitionNote(c, "");
    expect(first).not.toBeNull();
    expect(transitionNote(c, first?.key ?? "")).toBeNull();
    expect(transitionNote(c, first?.key ?? "")).toBeNull();
  });

  it("marks only the very first transition of a page load as on-load", () => {
    expect(transitionNote(clock({ phase: "open" }), "")?.first).toBe(true);
    expect(transitionNote(clock({ phase: "open" }), "7:printed")?.first).toBe(false);
  });

  it("pulses a print, pulses an open window that was watched, and nothing else", () => {
    expect(transitionNote(clock({ phase: "printed" }), "7:printing")?.pulse).toBe("print");
    expect(transitionNote(clock({ phase: "open" }), "6:printed")?.pulse).toBe("event");
    // An open window found on load was not an event anyone saw happen.
    expect(transitionNote(clock({ phase: "open" }), "")?.pulse).toBeNull();
    expect(transitionNote(clock({ phase: "notrade" }), "7:printing")?.pulse).toBeNull();
  });

  it("treats the same phase in a new epoch as a new transition", () => {
    expect(transitionNote(clock({ phase: "open", epoch: 8n }), "7:open")?.key).toBe("8:open");
  });
});

describe("the shared slot estimate", () => {
  beforeEach(() => {
    resetSlotEstimate();
    setSlotSeconds(SLOT_SECONDS_DEFAULT);
  });

  it("ignores a repeat of the same poll, so N callers cost one measurement", () => {
    recordPolledSlot(1_000);
    const after = slotSeconds();
    for (let i = 0; i < 5; i++) recordPolledSlot(1_000);
    expect(slotSeconds()).toBe(after);
  });

  // The race this replaced: each caller kept its own EMA seeded at the default and raced the others
  // to write, so a freshly mounted route dragged the measured rate back toward 0.45 — and that rate
  // is what every slots→time figure on the page is rendered through.
  it("keeps the measured rate when another caller folds the same polls in", () => {
    for (let i = 0; i <= 40; i++) recordPolledSlot(1_000 + i * 60);
    const measured = slotSeconds();
    recordPolledSlot(1_000 + 40 * 60);
    recordPolledSlot(1_000 + 40 * 60);
    expect(slotSeconds()).toBe(measured);
  });

  it("clamps to what a cluster can plausibly run at", () => {
    recordPolledSlot(0);
    recordPolledSlot(1);
    expect(slotSeconds()).toBeGreaterThanOrEqual(0.1);
    expect(slotSeconds()).toBeLessThanOrEqual(1);
  });

  /**
   * The estimate only moves forward and the rate is only re-measured once a poll has passed it, so an
   * estimate that gets ahead of the chain can never be corrected: it runs away and the clock reads
   * `overdue` with every countdown at zero until the page is reloaded. A restarted validator does it
   * instantly — which is exactly what `judging_day.sh down` then `up` does.
   */
  it("follows the chain again after the validator restarts at a lower slot", () => {
    for (let i = 0; i <= 30; i++) recordPolledSlot(500_000 + i * 18);
    expect(estimatedSlot() ?? 0).toBeGreaterThan(500_000);
    // The chain comes back near genesis.
    for (let i = 0; i < 5; i++) recordPolledSlot(1_000 + i * 18);
    expect(estimatedSlot() ?? 0).toBeLessThan(2_000);
  });

  it("does not re-seed on a single poll that merely lags", () => {
    for (let i = 0; i <= 30; i++) recordPolledSlot(500_000 + i * 18);
    const before = estimatedSlot() ?? 0;
    recordPolledSlot(500_000 + 29 * 18); // one stale read from a lagging replica
    expect(estimatedSlot() ?? 0).toBeGreaterThanOrEqual(before);
  });
});

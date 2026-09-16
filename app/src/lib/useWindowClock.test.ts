import type { auction, oracle } from "@thewindow/solana-sdk";
import { EpochStatus, PrintStatus } from "@thewindow/solana-sdk";
import { describe, expect, it } from "vitest";
import { derivePhase, popcount } from "./useWindowClock";

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

  it("printed stamps r* while fresh, then goes idle", () => {
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
    expect(derivePhase({ ...base, hasOpenEpoch: false, epoch: done, print: p, slot: 2_100 }).phase).toBe("idle");
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

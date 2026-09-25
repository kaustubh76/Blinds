import { describe, expect, it } from "vitest";
import {
  ASK,
  anchorTick,
  BID,
  blockedReason,
  DEFAULT_DIALS,
  explain,
  LENDER_OFFSET,
  MAX_TICK,
  quoteFor,
  RESTING_TICK,
  xorshift,
} from "./strategy";

/** `rand(n)` always returning the same value, so a quote is a function of the dials alone. */
const fixed = (v: number) => (n: number) => Math.min(v, Math.max(0, n - 1));

describe("the agents' strategy, as ported from services/admin/src/agents.rs", () => {
  it("defaults to the Rust constants", () => {
    expect(DEFAULT_DIALS).toEqual({
      restingTick: 12,
      band: 5,
      lenderOffset: 3,
      sizeMinUsdc: 100,
      sizeSpanUsdc: 2_000,
    });
  });

  it("anchors halfway between the last print and the resting tick, truncating", () => {
    expect(anchorTick(20)).toBe(16); // (20 + 12) / 2
    expect(anchorTick(13)).toBe(12); // (13 + 12) / 2 = 12.5 → 12, as integer division does
    expect(anchorTick(0)).toBe(6);
  });

  it("uses the resting tick itself before a first print (agents.rs:150-153)", () => {
    expect(anchorTick(null)).toBe(RESTING_TICK);
    expect(anchorTick(null, 20)).toBe(20);
  });

  it("puts the lender under the anchor and the borrower over it", () => {
    const lend = quoteFor(ASK, 20, DEFAULT_DIALS, fixed(0));
    const borrow = quoteFor(BID, 20, DEFAULT_DIALS, fixed(0));
    expect(lend.anchor).toBe(16);
    expect(lend.tick).toBe(16 - LENDER_OFFSET);
    expect(borrow.tick).toBe(16);
    expect(lend.side).toBe(ASK);
    expect(borrow.side).toBe(BID);
  });

  it("adds the spread on top of each side's arm", () => {
    expect(quoteFor(ASK, 20, DEFAULT_DIALS, fixed(4)).tick).toBe(16 - 3 + 4);
    expect(quoteFor(BID, 20, DEFAULT_DIALS, fixed(4)).tick).toBe(16 + 4);
  });

  it("clamps to the tick grid at both ends", () => {
    const low = quoteFor(ASK, 0, { ...DEFAULT_DIALS, restingTick: 0, lenderOffset: 30 }, fixed(0));
    expect(low.tick).toBe(0);
    const high = quoteFor(BID, MAX_TICK, { ...DEFAULT_DIALS, restingTick: MAX_TICK }, fixed(4));
    expect(high.tick).toBe(MAX_TICK);
  });

  it("sizes between the minimum and the minimum plus the span, in micro-USDC", () => {
    expect(quoteFor(BID, 12, DEFAULT_DIALS, fixed(0)).sizeMicroUsdc).toBe(100_000_000n);
    expect(quoteFor(BID, 12, DEFAULT_DIALS, fixed(1_999)).sizeMicroUsdc).toBe(2_099_000_000n);
  });

  it("never divides by zero when a dial is set to nothing", () => {
    const d = { ...DEFAULT_DIALS, band: 0, sizeSpanUsdc: 0, sizeMinUsdc: 0 };
    const q = quoteFor(BID, 12, d, xorshift(1));
    expect(q.tick).toBeGreaterThanOrEqual(0);
    expect(q.sizeMicroUsdc).toBe(1_000_000n);
  });

  describe("xorshift", () => {
    it("walks the same sequence for the same seed and a different one otherwise", () => {
      const a = xorshift(42);
      const b = xorshift(42);
      const c = xorshift(43);
      const seqA = [a(1000), a(1000), a(1000)];
      expect([b(1000), b(1000), b(1000)]).toEqual(seqA);
      expect([c(1000), c(1000), c(1000)]).not.toEqual(seqA);
    });

    it("matches xorshift64 computed independently (agents.rs:132-137)", () => {
      const mask = 0xffff_ffff_ffff_ffffn;
      let s = 42n;
      const step = () => {
        s ^= (s << 13n) & mask;
        s ^= s >> 7n;
        s ^= (s << 17n) & mask;
        s &= mask;
        return Number(s % 1000n);
      };
      const want = [step(), step(), step(), step()];
      const r = xorshift(42);
      expect([r(1000), r(1000), r(1000), r(1000)]).toEqual(want);
    });

    it("never gets stuck on a zero state", () => {
      const r = xorshift(0);
      expect(new Set([r(1000), r(1000), r(1000)]).size).toBeGreaterThan(1);
    });

    it("stays inside the range asked for", () => {
      const r = xorshift(7);
      for (let i = 0; i < 200; i++) {
        const v = r(5);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(5);
      }
    });
  });

  describe("when there is time to bid", () => {
    const open = { open: true, slot: 100, startSlot: 90, epochSlots: 30 };
    it("goes while the window is open and the margin fits", () => {
      expect(blockedReason(open)).toBeNull();
    });
    it("refuses when no window is open", () => {
      expect(blockedReason({ ...open, open: false })).toBe("no window is open");
    });
    it("refuses in the last slots, because a bid is three transactions (agents.rs:256)", () => {
      // closes at 120; 116 + 3 < 120 is the last slot that fits, 117 + 3 is not
      expect(blockedReason({ ...open, slot: 116 })).toBeNull();
      expect(blockedReason({ ...open, slot: 117 })).toBe("too late in this window");
      expect(blockedReason({ ...open, slot: 200 })).toBe("too late in this window");
    });
    it("says so when the slot is not known yet rather than guessing", () => {
      expect(blockedReason({ ...open, slot: null })).toBe("the slot is not known yet");
      expect(blockedReason({ ...open, epochSlots: null })).toBe("the slot is not known yet");
    });
  });

  it("explains a quote in terms of where it came from", () => {
    const q = quoteFor(BID, 20, DEFAULT_DIALS, fixed(2));
    const line = explain(q, DEFAULT_DIALS, 20);
    expect(line).toContain("anchor 16");
    expect(line).toContain("last print 20");
    expect(line).toContain("borrow");
    expect(line).toContain(`tick ${q.tick}`);
    expect(explain(q, DEFAULT_DIALS, null)).toContain("no print yet");
  });
});

import { describe, expect, it } from "vitest";
import type { ListingView } from "../../lib/chain";
import { quoteCollateral } from "./BorrowCalculator";

const listing = { haircutBps: 15_000n, decimals: 3 } as ListingView;
const price = { price: 40_012_000_000n, expo: -8 } as Parameters<typeof quoteCollateral>[2];

describe("quoteCollateral", () => {
  it("mirrors the program's requirement and the desk's pledge policy", () => {
    const q = quoteCollateral(1_000, listing, price);
    if (!q) throw new Error("no quote");
    expect(q.kC).toBe(40_012_000n);
    expect(q.kL).toBe(150n);
    expect(q.required).toBe(3_749n); // 1,000 USDC at $400.12, 150 % → 3.749 shares
    expect(q.pledge).toBeGreaterThan(q.required);
    expect(q.pledgeUsd).toBeCloseTo((Number(q.pledge) / 1_000) * 400.12, 2);
  });
  it("is null for nonsense input", () => {
    expect(quoteCollateral(0, listing, price)).toBeNull();
    expect(quoteCollateral(Number.NaN, listing, price)).toBeNull();
    expect(quoteCollateral(100, { ...listing, haircutBps: 9_000n } as ListingView, price)).toBeNull();
  });
});

import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The card judges both of the chain's rules. It used to judge only the quote's own age, so a mark that
 * was young but had not been posted in days carried no warning at all — while `lock_collateral` would
 * answer PriceStale. These cases pin each branch.
 */
const now = Math.floor(Date.now() / 1000);
const listing = {
  source: "pyth",
  symbol: "TSLAx-mock",
  listing: "5pJXoG111111111111111111111111111111111111",
  escrow: "93myeN111111111111111111111111111111111111",
  feedId: new Uint8Array(32).fill(0x11),
  haircutBps: 15000n,
  maxPublishAgeSecs: 3600,
  maxPriceAgeSlots: 1200,
};
const quote = vi.fn(() => ({
  data: { price: 37802053n, expo: -5, publishTime: BigInt(now - 60), postedSlot: 900n, from: "cache" },
}));
const slot = vi.fn(() => ({ data: 1000 }));

vi.mock("../../config", () => ({ config: { cluster: "devnet", adminUrl: "" } }));
vi.mock("../../lib/queries", () => ({
  useDeployment: () => ({ data: { listings: [listing], mockMint: "MockMint11111111111111111111111111111111111" } }),
  useCreditConfig: () => ({ data: { haircutBps: 15000n, tenorSlots: 1200n } }),
  useQuote: () => quote(),
  useSlot: () => slot(),
  useMultiplier: () => ({ data: { multiplier: 1 } }),
}));
vi.mock("../../lib/pyth", () => ({
  FEEDS: { "Equity.US.TSLA/USD": "feed" },
  useUnderlying: () => ({ data: null, isError: false }),
  nyseSession: () => ({ open: true, label: "regular hours" }),
  basisBps: () => 0,
  formatBasis: () => "0 bp",
}));
const { CollateralMark } = await import("./CollateralMark");

describe("the Pyth collateral mark", () => {
  beforeEach(() => {
    quote.mockReturnValue({
      data: { price: 37802053n, expo: -5, publishTime: BigInt(now - 60), postedSlot: 900n, from: "cache" },
    });
    slot.mockReturnValue({ data: 1000 });
  });

  it("shows no refusal while both rules pass", () => {
    const t = render(<CollateralMark />).container.textContent ?? "";
    expect(t).not.toContain("locks refused");
    expect(t).toContain("100 slots ago"); // 1000 − 900, in the unit the chain compares
    expect(t).not.toContain("NaN");
  });

  it("refuses on the post rule even when the quote itself is young", () => {
    slot.mockReturnValue({ data: 500_000 }); // 499,100 slots since the post; the limit is 1,200
    const t = render(<CollateralMark />).container.textContent ?? "";
    expect(t).toContain("posted too long ago · locks refused");
    expect(t).toContain("499,100 slots ago");
    expect(t).toContain("exceeded");
  });

  it("names the quote's own age when that is the rule that failed", () => {
    quote.mockReturnValue({
      data: { price: 37802053n, expo: -5, publishTime: BigInt(now - 7200), postedSlot: 900n, from: "cache" },
    });
    const t = render(<CollateralMark />).container.textContent ?? "";
    expect(t).toContain("locks refused");
    expect(t).toContain("quote older than");
    expect(t).not.toContain("posted too long ago");
  });
});

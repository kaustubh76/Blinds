import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

/**
 * The calculator quotes a pledge from whatever mark is on chain. It used to do that with no freshness
 * signal at all, under prose promising "the live mark" — so a mark nobody had posted in days produced
 * the same confident number as a fresh one. It must say when the chain would refuse the mark it used.
 */
const now = Math.floor(Date.now() / 1000);
const listings = [
  {
    key: "mock_tsla",
    symbol: "TSLAx-mock",
    source: "pyth",
    priceSource: 0,
    decimals: 3,
    haircutBps: 15000n,
    mockMint: "MockMint11111111111111111111111111111111111",
    maxPublishAgeSecs: 3600,
    maxPriceAgeSlots: 1200,
  },
];
const price = (over: Record<string, unknown> = {}) => ({
  price: 37802053n,
  expo: -5,
  publishTime: BigInt(now - 60),
  postedSlot: 900n,
  ...over,
});
const slot = vi.fn(() => ({ data: 1000 }));

vi.mock("../../config", () => ({ config: { cluster: "devnet", adminUrl: "" } }));
vi.mock("../../lib/queries", () => ({
  useMultiplier: () => ({ data: { multiplier: 1 } }),
  useSlot: () => slot(),
}));
// Real module builds an RPC transport at import; only `sourceLabel` is used here.
vi.mock("../../lib/listings", () => ({ sourceLabel: () => "Pyth" }));
const { BorrowCalculator } = await import("./BorrowCalculator");

const view = (prices: Array<ReturnType<typeof price> | null>) =>
  render(
    <BorrowCalculator
      listings={listings as unknown as Parameters<typeof BorrowCalculator>[0]["listings"]}
      prices={prices as unknown as Parameters<typeof BorrowCalculator>[0]["prices"]}
      lastRateTick={8}
      onStart={vi.fn()}
    />,
  ).container.textContent ?? "";

describe("the borrow calculator", () => {
  it("quotes a pledge with no warning while the mark is usable", () => {
    slot.mockReturnValue({ data: 1000 });
    const t = view([price()]);
    expect(t).toContain("you would pledge");
    expect(t).not.toContain("would refuse it right now");
    expect(t).not.toContain("NaN");
  });

  it("says the chain would refuse a mark nobody has posted lately", () => {
    slot.mockReturnValue({ data: 500_000 });
    const t = view([price()]);
    expect(t).toContain("has not been posted lately — the chain would refuse it right now");
    expect(t).toContain("stale");
  });

  it("says so for a mark past its own age limit too", () => {
    slot.mockReturnValue({ data: 1000 });
    const t = view([price({ publishTime: BigInt(now - 7200) })]);
    expect(t).toContain("past its age limit — the chain would refuse it right now");
  });
});

describe("which collateral it opens on", () => {
  // A schedule where the first listing's mark is a week old — the shape the desk is actually in
  // while Pyth's own account for that feed sits stale.
  const three = [
    { ...listings[0], key: "mock_tsla", symbol: "TSLAx-mock" },
    { ...listings[0], key: "prestocks_anthropic", symbol: "ANTHROPIC-mock", haircutBps: 20000n },
    { ...listings[0], key: "xstocks_tslax", symbol: "TSLAx-xs" },
  ];
  const viewThree = (prices: unknown[]) =>
    render(
      <BorrowCalculator
        listings={three as unknown as Parameters<typeof BorrowCalculator>[0]["listings"]}
        prices={prices as unknown as Parameters<typeof BorrowCalculator>[0]["prices"]}
        lastRateTick={8}
        onStart={vi.fn()}
      />,
    ).container.textContent ?? "";

  it("opens on a collateral the chain would accept, not merely the first one", () => {
    slot.mockReturnValue({ data: 1000 });
    const t = viewThree([price({ publishTime: BigInt(now - 604_800) }), price(), price()]);
    // It used to open on listings[0] and quote a loan nobody could take, under its own warning.
    expect(t).toContain("ANTHROPIC");
    expect(t).not.toContain("would refuse it right now");
  });

  it("still opens on the first when none is acceptable, and says so", () => {
    slot.mockReturnValue({ data: 1000 });
    const stale = price({ publishTime: BigInt(now - 604_800) });
    const t = viewThree([stale, stale, stale]);
    expect(t).toContain("past its age limit — the chain would refuse it right now");
  });
});

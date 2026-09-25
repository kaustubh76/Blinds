import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const now = Math.floor(Date.now() / 1000);
const feedId = new Uint8Array(32).fill(0xab);
const listing = {
  source: "prestocks",
  symbol: "ANTHROPIC-mock",
  listing: "4qQ4A9111111111111111111111111111111111111",
  escrow: "93myeN111111111111111111111111111111111111",
  cstockMint: "DA7UsQD5zwnVTyEcL1RVc5DsDDokfqx9a6AVSTaP8rNo",
  feedId,
  haircutBps: 20000n,
  maxPublishAgeSecs: 172800,
  maxPriceAgeSlots: 1200,
};
const marks = vi.fn();
const mint = vi.fn();
const quote = vi.fn(() => ({
  data: { price: 105143999341n, expo: -8, publishTime: BigInt(now - 600), postedSlot: 100n },
}));
const slot = vi.fn(() => ({ data: 1000 }));
vi.mock("../../config", () => ({ config: { cluster: "devnet", adminUrl: "https://admin.example" } }));
vi.mock("../../lib/queries", () => ({
  useDeployment: () => ({ data: { listings: [{ source: "pyth" }, listing] } }),
  useQuote: () => quote(),
  useSlot: () => slot(),
  useMarks: () => marks(),
  useMainnetMint: () => mint(),
}));
const { PreStocksMark, snapshotFor } = await import("./PreStocksMark");

const REAL = {
  program: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb",
  decimals: 9,
  supply: 7381.829092847,
  extensions: [
    "permanentDelegate",
    "transferFeeConfig",
    "confidentialTransferMint",
    "scaledUiAmountConfig",
    "transferHook",
  ],
};

const snap = {
  key: "prestocks_anthropic",
  symbol: "ANTHROPIC-mock",
  source: "prestocks",
  feed_id_hex: "ab".repeat(32),
  url: "https://prestocks.com/api/prestocks",
  mark_e8: 105_143_999_341,
  implied_e8: 103_987_682_509,
  basis_bps: -110,
  mark_valuation_usd: 1_721_033_511_558,
  implied_valuation_usd: 1_726_843_818_616,
  supply_e8: 738_182_909_284,
  fetched_at: now - 30,
};

describe("the PreStocks mark card", () => {
  it("matches the keeper's snapshot on the feed id, never on a name", () => {
    expect(snapshotFor({ x: snap }, "ab".repeat(32))).toBe(snap);
    expect(snapshotFor({ x: snap }, "cd".repeat(32))).toBeNull();
    expect(snapshotFor(null, "ab".repeat(32))).toBeNull();
  });
  it("shows the mark, the implied price and the basis when the keeper answers", () => {
    marks.mockReturnValue({ data: { prestocks_anthropic: snap }, isFetching: false });
    mint.mockReturnValue({ data: REAL, isError: false });
    const { container } = render(<PreStocksMark />);
    const t = container.textContent ?? "";
    expect(t).toContain("$1,051.44");
    expect(t).toContain("$1,039.88");
    expect(t).toMatch(/−?-?110 bps|-110|−110/);
    expect(t).toContain("200%");
    expect(t).toContain("attested");
    expect(t).toContain("$1.72T marked vs $1.73T implied"); // the same gap at company scale
    expect(t).not.toContain("NaN");
  });

  it("reads the real mainnet token and says what its extensions mean", () => {
    marks.mockReturnValue({ data: null, isFetching: false });
    mint.mockReturnValue({ data: REAL, isError: false });
    const { container } = render(<PreStocksMark />);
    const t = container.textContent ?? "";
    expect(t).toContain("the real token · mainnet");
    expect(t).toContain("7,382 ANTHROPIC");
    expect(t).toContain("Token-2022 · 9 dp");
    expect(t).toContain("confidentialTransferMint");
    expect(t).toContain("transferHook");
    expect(t).toContain("a bonding curve cannot quote in it");
  });

  it("drops the real-token block when mainnet does not answer", () => {
    marks.mockReturnValue({ data: null, isFetching: false });
    mint.mockReturnValue({ data: null, isError: true });
    const { container } = render(<PreStocksMark />);
    const t = container.textContent ?? "";
    expect(t).toContain("mainnet RPC unreachable");
    // The extensions line exists only when the mainnet read succeeded.
    expect(t).not.toContain("Token-2022 extensions");
    expect(t).toContain("$1,051.44"); // the on-chain mark still shows
  });
  it("says what the implied price waits on when the keeper does not answer", () => {
    marks.mockReturnValue({ data: null, isFetching: false });
    mint.mockReturnValue({ data: null, isError: false });
    const { container } = render(<PreStocksMark />);
    const t = container.textContent ?? "";
    expect(t).toContain("$1,051.44");
    expect(t).toContain("the keeper did not answer");
    expect(container.querySelector("#prestocks")).not.toBeNull();
  });

  // The card used to judge the publish rule alone, so a mark nobody had posted in days carried the
  // all-good badge while `lock_collateral` was certain to answer PriceStale.
  it("refuses to look acceptable when the post is older than the chain allows", () => {
    marks.mockReturnValue({ data: null, isFetching: false });
    mint.mockReturnValue({ data: null, isError: false });
    slot.mockReturnValue({ data: 1_000_000 }); // 999,900 slots since the post; the limit is 1,200
    const { container } = render(<PreStocksMark />);
    const t = container.textContent ?? "";
    expect(t).toContain("posted too long ago · locks refused");
    expect(t).not.toContain("the chain would accept a lock");
    expect(t).toContain("999,900 slots ago");
    expect(t).toContain("exceeded");
    slot.mockReturnValue({ data: 1000 });
  });

  // With no market running the traded price and basis come from this site's own PreStocks read, and
  // the card has to say which — the mark above it is still the chain's 40-hour-old copy.
  it("shows a live traded price when the keeper is down, and says it is live", () => {
    marks.mockReturnValue({
      data: {
        prestocks_anthropic: { ...snap, source: "prestocks-live", fetched_at: now - 5, implied_e8: 105_121_876_682 },
      },
      isFetching: false,
    });
    mint.mockReturnValue({ data: null, isError: false });
    const { container } = render(<PreStocksMark />);
    const t = container.textContent ?? "";
    expect(t).toContain("$1,051.22"); // the traded price, live
    expect(t).toContain("live from PreStocks");
    expect(t).toContain("traded vs PreStocks' mark");
    expect(t).not.toContain("the keeper's last read");
  });

  it("says the chain would accept a lock when both rules pass", () => {
    marks.mockReturnValue({ data: null, isFetching: false });
    mint.mockReturnValue({ data: null, isError: false });
    const { container } = render(<PreStocksMark />);
    const t = container.textContent ?? "";
    expect(t).toContain("the chain would accept a lock");
    expect(t).toContain("900 slots ago");
  });
});

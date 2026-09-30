import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const now = Math.floor(Date.now() / 1000);
const feedId = new Uint8Array(32).fill(0xab);
const listing = {
  key: "prestocks_anthropic",
  source: "prestocks",
  provider: "prestocks",
  priceSource: 2,
  sourceMint: "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw",
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
/** Jupiter read straight from the browser; the keeper's snapshot still wins when there is one. */
type JupLive = { usd: number; stock: number | null; mcap: number | null; fetchedAt: number };
const jupLive = vi.fn((): { data: JupLive | null } => ({ data: null }));
const mint = vi.fn();
const quote = vi.fn(() => ({
  data: { price: 105143999341n, expo: -8, publishTime: BigInt(now - 600), postedSlot: 100n },
}));
const slot = vi.fn(() => ({ data: 1000 }));
vi.mock("../../config", () => ({ config: { cluster: "devnet", adminUrl: "https://admin.example" } }));
vi.mock("../../lib/queries", () => ({
  useQuote: () => quote(),
  useSlot: () => slot(),
  useMarks: () => marks(),
  useJupiterMark: () => jupLive(),
  useMainnetMint: () => mint(),
}));
const { AttestedMark, snapshotFor } = await import("./AttestedMark");
type Listing = Parameters<typeof AttestedMark>[0]["listing"];
const card = (over: Record<string, unknown> = {}) =>
  render(<AttestedMark listing={{ ...listing, ...over } as unknown as Listing} />).container;

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

describe("an attested mark card", () => {
  it("matches the keeper's snapshot on the feed id, never on a name", () => {
    expect(snapshotFor({ x: snap }, "ab".repeat(32))).toBe(snap);
    expect(snapshotFor({ x: snap }, "cd".repeat(32))).toBeNull();
    expect(snapshotFor(null, "ab".repeat(32))).toBeNull();
  });
  it("shows the mark, the implied price and the basis when the keeper answers", () => {
    marks.mockReturnValue({ data: { prestocks_anthropic: snap }, isFetching: false });
    mint.mockReturnValue({ data: REAL, isError: false });
    const container = card();
    const t = container.textContent ?? "";
    expect(t).toContain("$1,051.44");
    expect(t).toContain("$1,039.88");
    expect(t).toMatch(/−?-?110 bps|-110|−110/);
    expect(t).toContain("200%");
    expect(t).toContain("attested");
    expect(t).toContain("$1.72T at the mark"); // the same gap at company scale
    expect(t).toContain("$1.73T implied");
    expect(t).not.toContain("NaN");
  });

  it("reads the real mainnet token and says what its extensions mean", () => {
    marks.mockReturnValue({ data: null, isFetching: false });
    mint.mockReturnValue({ data: REAL, isError: false });
    const container = card();
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
    const container = card();
    const t = container.textContent ?? "";
    expect(t).toContain("mainnet RPC unreachable");
    // The extensions line exists only when the mainnet read succeeded.
    expect(t).not.toContain("Token-2022 extensions");
    expect(t).toContain("$1,051.44"); // the on-chain mark still shows
  });
  it("says what the implied price waits on when the keeper does not answer", () => {
    marks.mockReturnValue({ data: null, isFetching: false });
    mint.mockReturnValue({ data: null, isError: false });
    const container = card();
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
    const container = card();
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
    const container = card();
    const t = container.textContent ?? "";
    expect(t).toContain("$1,051.22"); // the traded price, live
    expect(t).toContain("live from PreStocks");
    expect(t).toContain("traded vs the mark");
    expect(t).not.toContain("the keeper's last read");
  });

  it("says the chain would accept a lock when both rules pass", () => {
    marks.mockReturnValue({ data: null, isFetching: false });
    mint.mockReturnValue({ data: null, isError: false });
    const container = card();
    const t = container.textContent ?? "";
    expect(t).toContain("the chain would accept a lock");
    expect(t).toContain("900 slots ago");
  });
});

// The same card, a different provider. Before this it was PreStocks-shaped throughout, with the
// mainnet mint a constant in the file — which a second attested-mark listing made untenable.
describe("the same card for a second provider", () => {
  const jup = {
    key: "xstocks_tslax",
    provider: "jupiter",
    symbol: "TSLAx-xs",
    sourceMint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    haircutBps: 15000n,
    maxPublishAgeSecs: 3600,
  };
  // The card's headline is the quote the *chain* holds (`useQuote`), never the keeper's snapshot —
  // so this has to move with the listing, or the assertion below would be testing the mock.
  beforeEach(() => {
    quote.mockReturnValue({
      data: { price: 35_127_284_640n, expo: -8, publishTime: BigInt(now - 30), postedSlot: 100n },
    });
  });
  afterEach(() => {
    quote.mockReturnValue({
      data: { price: 105143999341n, expo: -8, publishTime: BigInt(now - 600), postedSlot: 100n },
    });
  });

  const jupSnap = {
    ...snap,
    key: "xstocks_tslax",
    source: "jupiter",
    mark_e8: 35_127_284_640,
    implied_e8: 35_030_000_000,
    mark_valuation_usd: 1_393_558_302_498,
    implied_valuation_usd: null,
    supply_e8: null,
  };

  it("names Jupiter, its own field, and the basis against the stock itself", () => {
    marks.mockReturnValue({ data: { xstocks_tslax: jupSnap }, isFetching: false });
    mint.mockReturnValue({ data: null, isError: false });
    const t = card(jup).textContent ?? "";
    expect(t).toContain("Jupiter mark");
    expect(t).toContain("Jupiter stockData.price");
    expect(t).toContain("the token vs the stock");
    expect(t).toContain("$351.27"); // the mark the chain holds
    expect(t).toContain("$350.30"); // the stock itself
    expect(t).toContain("150%");
    expect(t).not.toContain("PreStocks");
    expect(t).not.toContain("pre-IPO");
    expect(t).not.toContain("NaN");
  });

  it("shows a lone company-scale figure — this used to need both, and showed neither", () => {
    marks.mockReturnValue({ data: { xstocks_tslax: jupSnap }, isFetching: false });
    mint.mockReturnValue({ data: null, isError: false });
    const t = card(jup).textContent ?? "";
    expect(t).toContain("$1.39T at the mark");
    expect(t).not.toContain("implied");
  });

  it("anchors on the provider, so #/market/jupiter reaches it", () => {
    marks.mockReturnValue({ data: null, isFetching: false });
    mint.mockReturnValue({ data: null, isError: false });
    expect(card(jup).querySelector("#jupiter")).not.toBeNull();
  });

  it("says so rather than guessing when the descriptor records no mainnet mint", () => {
    marks.mockReturnValue({ data: null, isFetching: false });
    mint.mockReturnValue({ data: null, isError: false });
    const t = card({ ...jup, sourceMint: null }).textContent ?? "";
    expect(t).toContain("records no mainnet mint");
  });
});

// The keeper is the source that matches what is on chain, so its snapshot must win; but with no
// market running the card used to show "—" for this provider, because the only live fallback this
// site had read PreStocks. Jupiter answers a page origin directly, so it needs no function at all.
describe("the live browser read, when no keeper answers", () => {
  const jup = {
    key: "xstocks_tslax",
    provider: "jupiter",
    symbol: "TSLAx-xs",
    sourceMint: "XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB",
    sourceSymbol: "TSLAx",
    haircutBps: 15000n,
    maxPublishAgeSecs: 3600,
  };
  const live = { usd: 351.27, stock: 350.3, mcap: 1_393_558_302_498, fetchedAt: now - 5 };

  it("fills the stock price and the company figure from the browser's own read", () => {
    marks.mockReturnValue({ data: null, isFetching: false });
    mint.mockReturnValue({ data: null, isError: false });
    jupLive.mockReturnValue({ data: live });
    const t = card(jup).textContent ?? "";
    expect(t).toContain("$350.30");
    expect(t).toContain("$1.39T at the mark");
    expect(t).toContain("live from Jupiter");
    expect(t).not.toContain("the keeper did not answer");
    jupLive.mockReturnValue({ data: null });
  });

  it("prefers the keeper's snapshot, because that is the view matching the chain", () => {
    marks.mockReturnValue({ data: { xstocks_tslax: { ...snap, implied_e8: 34_000_000_000 } }, isFetching: false });
    mint.mockReturnValue({ data: null, isError: false });
    jupLive.mockReturnValue({ data: live });
    const t = card(jup).textContent ?? "";
    expect(t).toContain("$340.00"); // the keeper's read, not the browser's
    expect(t).toContain("the keeper's last read");
    jupLive.mockReturnValue({ data: null });
  });

  it("labels the mainnet supply with the real token's symbol, not the twin's", () => {
    marks.mockReturnValue({ data: null, isFetching: false });
    mint.mockReturnValue({ data: { ...REAL, decimals: 8, supply: 229_636 }, isError: false });
    const t = card(jup).textContent ?? "";
    expect(t).toContain("229,636 TSLAx");
    expect(t).not.toContain("229,636 TSLAx-xs");
  });
});

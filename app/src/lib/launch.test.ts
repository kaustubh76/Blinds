import { readFileSync } from "node:fs";
import { decodeDbcConfig, decodeDbcPool } from "@thewindow/solana-sdk";
import { describe, expect, it, vi } from "vitest";

// The hook module reads the app config and builds RPC clients at import; the pure functions do not need them.
vi.mock("../config", () => ({ config: { cluster: "devnet", rpcUrl: "https://rpc.example" } }));
vi.mock("./chain", () => ({ rpc: {} }));
vi.mock("./pyth", () => ({ FEEDS: {}, fetchFreshest: async () => null, mainnetRpc: {} }));

const { chooseQuote, deriveLaunchState, QUOTE_MAX_AGE_SECS } = await import("./launch");

const fixture = (f: string) =>
  new Uint8Array(
    Buffer.from(readFileSync(new URL(`../../../sdk/test/fixtures/${f}`, import.meta.url), "utf8").trim(), "base64"),
  );
const pool = decodeDbcPool(fixture("dbc_pool_devnet.b64"));
const config = decodeDbcConfig(fixture("dbc_config_devnet.b64"));
const dbc = { pool, config, progress: Number(pool.quoteReserve) / Number(config.migrationQuoteThreshold) };
const record = {
  quote: { mint: config.quoteMint, decimals: 8, usd: 365, pythAccount: "", publishTime: 0, ageSecs: 0 },
  creator: pool.creator,
};

describe("which Pyth read prices the quote stock", () => {
  const at = (publishTime: number) => ({ publishTime, price: 1n, expo: 0 });
  it("prefers the wrapper feed while it is fresh", () => {
    expect(chooseQuote(at(1000), at(2000), 1000 + 60)?.feed).toBe("Crypto.TSLAX/USD");
  });
  it("falls back to the equity feed once the wrapper's account has died", () => {
    const now = 1000 + QUOTE_MAX_AGE_SECS + 1;
    expect(chooseQuote(at(1000), at(now - 5), now)).toMatchObject({ feed: "Equity.US.TSLA/USD", ageSecs: 5 });
    expect(chooseQuote(at(1000), null, now)?.feed).toBe("Crypto.TSLAX/USD");
    expect(chooseQuote(null, null, now)).toBeNull();
  });
});

describe("the card's numbers from the pool", () => {
  it("derives the raise, the threshold, the fees and the spot from the devnet fixture", () => {
    const s = deriveLaunchState(dbc, { price: 36750n, expo: -2, feed: "Equity.US.TSLA/USD", ageSecs: 9 }, record);
    expect(s).not.toBeNull();
    expect(s?.raisedQuote).toBeCloseTo(4.85, 8);
    expect(s?.thresholdQuote).toBeCloseTo(168.50157355, 6);
    expect(s?.creatorFeeQuote).toBeCloseTo(0.06, 8);
    expect(s?.quoteUsd).toBeCloseTo(367.5, 6);
    expect(s?.quoteFeed).toBe("Equity.US.TSLA/USD");
    expect(s?.spotQuote).toBeGreaterThan(0);
    expect(s?.feesToAgent).toBeNull(); // no agent recorded
  });
  it("uses the launch-time price when Pyth is unreadable", () => {
    const s = deriveLaunchState(dbc, null, record);
    expect(s?.quoteUsd).toBe(365);
    expect(s?.quoteFeed).toBeNull();
  });
  it("checks that fees really flow to the recorded agent wallet", () => {
    const agent = { id: "a", name: "The Window Lender", walletAddress: pool.creator };
    expect(deriveLaunchState(dbc, null, { ...record, agent })?.feesToAgent).toBe(true);
    const other = { ...agent, walletAddress: "11111111111111111111111111111111" };
    expect(deriveLaunchState(dbc, null, { ...record, agent: other })?.feesToAgent).toBe(false);
  });
  it("refuses numbers that do not add up instead of rendering NaN", () => {
    expect(deriveLaunchState(dbc, null, { ...record, quote: { ...record.quote, usd: Number.NaN } })).toBeNull();
    const zero = { ...dbc, config: { ...config, migrationQuoteThreshold: 0n } };
    expect(deriveLaunchState(zero, null, record)).toBeNull();
  });
});

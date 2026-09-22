import { readFileSync } from "node:fs";
import { join } from "node:path";
import { render } from "@testing-library/react";
import { decodeDbcConfig, decodeDbcPool } from "@thewindow/solana-sdk";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// vitest runs with the package as cwd; jsdom rewrites import.meta.url, so the path is built from cwd
const fixture = (f: string) =>
  new Uint8Array(Buffer.from(readFileSync(join(process.cwd(), "../sdk/test/fixtures", f), "utf8").trim(), "base64"));
const pool = decodeDbcPool(fixture("dbc_pool_devnet.b64"));
const config = decodeDbcConfig(fixture("dbc_config_devnet.b64"));

const state = {
  pool,
  config,
  progress: 0.0288,
  raisedQuote: 4.85,
  thresholdQuote: 168.5,
  creatorFeeQuote: 0.06,
  partnerFeeQuote: 0.06,
  totalFeeQuote: 0.12,
  spotQuote: 7.72e-8,
  quoteUsd: 367.5,
  quoteFeed: "Equity.US.TSLA/USD",
  quoteAgeSecs: 9,
  feesToAgent: true,
};
const record = {
  cluster: "devnet",
  quote: { mint: config.quoteMint, decimals: 8, usd: 365 },
  numbers: {
    migrationUsd: 250_000,
    feeBps: { open: 300, rest: 30, periods: 48, durationSecs: 14400 },
    raiseToAgentPct: 10,
    creatorFeePct: 50,
    supply: 1e9,
  },
  token: { name: "The Window Lender", symbol: "WLEND" },
  config: "HsfeZeTwmebMbu1Mtj2dLBU5EW2BvAhZErayN8RJGPZr",
  pool: "EZyMqXWBk5Z5jLnrZJ1NM8AseSmFaRvn2XSKZSrv6BTg",
  baseMint: pool.baseMint,
  creator: pool.creator,
  txs: {},
  agent: { id: "a", name: "The Window Lender", walletAddress: pool.creator },
};

const query = vi.fn();
vi.mock("../../lib/launch", () => ({
  LAUNCH: record,
  launchCluster: "devnet",
  tradeUrl: null,
  useLaunch: () => query(),
}));
const { LenderAgent } = await import("./LenderAgent");

const base = { isLoading: false, isError: false, isFetching: false, refetch: vi.fn(), data: undefined };

describe("the lender agent card", () => {
  beforeEach(() => query.mockReset());
  afterEach(() => vi.useRealTimers());

  it("shows skeletons, no badge and no bar while reading", () => {
    query.mockReturnValue({ ...base, isLoading: true });
    const { container } = render(<LenderAgent />);
    expect(container.textContent).toContain("reading the pool…");
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThan(0);
    expect(container.textContent).not.toContain("on the curve");
    expect(container.textContent).not.toContain("NaN");
  });

  it("names the RPC failure and offers a refresh", () => {
    const refetch = vi.fn();
    query.mockReturnValue({ ...base, isError: true, refetch });
    const { container, getByText } = render(<LenderAgent />);
    expect(container.textContent).toContain("rpc busy");
    expect(container.textContent).toContain("the RPC did not answer");
    getByText("refresh").click();
    expect(refetch).toHaveBeenCalled();
  });

  it("says when the record is ahead of the chain", () => {
    query.mockReturnValue({ ...base, data: { kind: "missing" } });
    const { container } = render(<LenderAgent />);
    expect(container.textContent).toContain("pool not on chain yet");
    expect(container.textContent).toContain(record.pool);
  });

  it("renders the numbers, the fee now and the agent check from a real pool", () => {
    query.mockReturnValue({ ...base, data: { kind: "ok", state } });
    // 7 periods and 5 s after the pool opened: the seventh step of the exponential schedule
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime((Number(pool.activationPoint) + 7 * 300 + 5) * 1000);
    const { container } = render(<LenderAgent />);
    const t = container.textContent ?? "";
    expect(t).toContain("2.9 % of the way to graduation");
    expect(t).toContain("4.85 quote");
    expect(t).toContain("168.5 quote");
    expect(t).toContain("fee now2.14 %"); // 300 bp × 0.9532⁷
    expect(t).toContain("period 7 of 48 · next step in 4m 55s");
    expect(t).toContain("opened 35 min ago");
    const bar = container.querySelector('[role="progressbar"]');
    expect(bar?.getAttribute("aria-valuenow")).toBe("3");
    expect(container.querySelector('svg[aria-label="fee schedule, period 7 of 48"]')).not.toBeNull();
    expect(t).toContain("fees flow to the agent");
    expect(t).toContain("Pyth Equity.US.TSLA/USD");
    expect(t).toContain("devnet rehearsal");
    expect(t).not.toContain("NaN");
    expect(t).not.toContain("graduated to DAMM v2");
  });

  it("says so when the chain's creator or fee claimer is not the agent wallet (a rehearsal fact on devnet)", () => {
    query.mockReturnValue({ ...base, data: { kind: "ok", state: { ...state, feesToAgent: false } } });
    const { container } = render(<LenderAgent />);
    expect(container.textContent).toContain("rehearsal launched by the payer, before the identity");
    expect(container.textContent).not.toContain("fees flow to the agent");
  });

  it("shows the resting fee once the schedule has run out, and graduation from the chain only", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime((Number(pool.activationPoint) + 5 * 3600) * 1000);
    query.mockReturnValue({ ...base, data: { kind: "ok", state: { ...state, pool: { ...pool, isMigrated: true } } } });
    const { container } = render(<LenderAgent />);
    const t = container.textContent ?? "";
    expect(t).toContain("resting fee");
    expect(t).toContain("graduated · liquidity now on DAMM v2");
    expect(t).toContain("graduated to DAMM v2");
  });

  it("lifts the card and scrolls to it when the route asks for it", () => {
    query.mockReturnValue({ ...base, data: { kind: "ok", state } });
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    const { container } = render(<LenderAgent focus />);
    expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "smooth" });
    expect(container.querySelector("#lender-agent section")?.className).toContain("border-accent");
  });
});

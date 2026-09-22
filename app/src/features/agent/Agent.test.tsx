import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const record = {
  cluster: "devnet",
  quote: { mint: "Q", decimals: 8, usd: 365, feed: "Equity.US.TSLA/USD" },
  numbers: {
    initialUsd: 25_000,
    migrationUsd: 250_000,
    initialMarketCapQuote: 68.45,
    migrationMarketCapQuote: 684.5,
    migrationQuoteThreshold: 168.5,
    feeBps: { open: 300, rest: 30, periods: 48, durationSecs: 14400 },
    raiseToAgentPct: 10,
    creatorFeePct: 50,
    supply: 1e9,
  },
  token: { symbol: "WLEND" },
  config: "HsfeZeTwmebMbu1Mtj2dLBU5EW2BvAhZErayN8RJGPZr",
  pool: "EZyMqXWBk5Z5jLnrZJ1NM8AseSmFaRvn2XSKZSrv6BTg",
  baseMint: "72QJmsn48nkLKM6zDr5hjVvoEuJGrRRtS81iv8geZL1m",
  creator: "39VKQn2Skp67mFYfiFfvRLEKsxaTtHqQWRop5q9cA7sM",
  txs: {},
  agent: {
    id: "0044b672-ec2c",
    walletAddress: "39VKQn2Skp67mFYfiFfvRLEKsxaTtHqQWRop5q9cA7sM",
    name: "The Window Lender",
  },
};
vi.mock("../../lib/launch", () => ({
  LAUNCH: record,
  DEVNET_LAUNCH: record,
  MAINNET_LAUNCH: null,
  launchCluster: "devnet",
  tradeUrl: null,
  useLaunch: () => ({
    data: { kind: "missing" },
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));
vi.mock("../../lib/queries", () => ({
  useDeployment: () => ({
    data: {
      raw: {
        agents: [
          { index: 0, role: "lender", listing: 0 },
          { index: 1, role: "lender", listing: 1 },
          { index: 2, role: "borrower", listing: 0 },
        ],
      },
      listings: [{ symbol: "TSLAx-mock" }, { symbol: "ANTHROPIC-mock" }],
    },
  }),
  useOracle: () => ({ data: { hasPrinted: true, lastPrintEpoch: 470n, lastRStarTick: 8 } }),
}));
const { Agent } = await import("./Agent");

describe("the agent page", () => {
  it("shows the journey, the desk numbers, the curve table and the Clawpump identity from the records", () => {
    const { container } = render(<Agent />);
    const t = container.textContent ?? "";
    expect(t).toContain("An agent that lends, and owns its own curve");
    expect(t).toContain("2 of 5 steps done");
    expect(t).toContain("waits on you");
    expect(container.querySelectorAll('[data-state="done"]')).toHaveLength(2);
    expect(t).toContain("lending on TSLAx-mock and ANTHROPIC-mock");
    expect(t).toContain("Why this pool looks the way it does");
    expect(t).toContain("$250,000 fully diluted");
    expect(t).toContain("The Window Lender");
    expect(t).toContain("identity coin pending");
    expect(t).toContain("pool not on chain yet");
    expect(t).not.toContain("NaN");
  });
});

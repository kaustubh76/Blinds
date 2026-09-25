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
    creatorFeePct: 0,
    supply: 1e9,
  },
  token: { symbol: "WLEND" },
  config: "HsfeZeTwmebMbu1Mtj2dLBU5EW2BvAhZErayN8RJGPZr",
  pool: "EZyMqXWBk5Z5jLnrZJ1NM8AseSmFaRvn2XSKZSrv6BTg",
  baseMint: "72QJmsn48nkLKM6zDr5hjVvoEuJGrRRtS81iv8geZL1m",
  // Two roles, as a real record now carries them: the launch key signs, the agent claims.
  creator: "3bku8abYECxZxfoXDsTjcCCBv7JMF6BKTREeJLeVDnJX",
  feeClaimer: "39VKQn2Skp67mFYfiFfvRLEKsxaTtHqQWRop5q9cA7sM",
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
  MAINNET_PLAN: null,
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
          { index: 0, role: "lender", listing: 0, wallet: "51gsw5oEYXhcUVPQWW4c5Y5c1HWABtgzNMNdWCDLr62z" },
          { index: 1, role: "lender", listing: 1, wallet: "FXCVh2Qavdw26hczhGEoAHaXe1pmSdBM7tRXTUQEjvnE" },
          { index: 2, role: "borrower", listing: 0, wallet: "FFfZbJAyCBWBZuM6qwtudN2Xw998LU8b7u4WWfGKg4yf" },
        ],
      },
      listings: [{ symbol: "TSLAx-mock" }, { symbol: "ANTHROPIC-mock" }],
    },
  }),
  useOracle: () => ({ data: { hasPrinted: true, lastPrintEpoch: 470n, lastRStarTick: 8 } }),
  // The roster reads the chain per agent, but only for a row you open; none is open on first render.
  useBids: () => ({ data: [] }),
  useLoans: () => ({ data: { borrowed: [], lent: [] } }),
  // The identity coin is read from mainnet, so "identity coin on mainnet" is a fact about the chain
  // rather than the presence of a mint in the record. Unanswered here, as on a first paint.
  useMainnetMint: () => ({ data: null, isError: false }),
}));
// No key connected, which is what a first visit looks like: the browser agent offers one instead of
// running. `useDesk` is never reached, so nothing here touches wasm or an RPC.
vi.mock("../../lib/wallet", () => ({
  useSession: () => ({ account: null, wallets: [], connect: vi.fn(), disconnect: vi.fn() }),
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

  it("lists every simulated member as an address you can look up, not just a count", () => {
    const { container } = render(<Agent />);
    const t = container.textContent ?? "";
    expect(t).toContain("3 simulated members");
    // Truncated the way `ExplorerLink` truncates, so the row is a link to that wallet.
    expect(t).toContain("51gs…r62z");
    expect(t).toContain("FFfZ…g4yf");
    // Reading the chain is opt-in: nothing is fetched until a row is opened.
    expect(container.querySelectorAll("button")).not.toHaveLength(0);
    expect(t).toContain("read the chain for all 3");
  });

  it("offers a key so the agents' own strategy can be run here, and does not pretend to run without one", () => {
    const t = render(<Agent />).container.textContent ?? "";
    expect(t).toContain("Quote a window with the agents' own strategy");
    expect(t).toMatch(/devnet burner/);
    expect(t).not.toContain("Quote now");
  });

  it("shows the commands that move the selected journey step along", () => {
    const t = render(<Agent />).container.textContent ?? "";
    // The first unfinished step is selected by default; for these records that is the mainnet pool.
    expect(t).toContain("pnpm --filter @thewindow/launch");
    expect(t).toContain("spends devnet");
  });

  it("does not repeat the agent identity block that the Clawpump card already shows in full", () => {
    const { container } = render(<Agent />);
    // `variant="page"`: one wallet row, not two, and no footer linking to the page you are on.
    expect(container.querySelectorAll('a[href="#/agent"]')).toHaveLength(0);
  });
});

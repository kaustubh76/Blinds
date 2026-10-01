import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("../../lib/launch", () => ({
  LAUNCH: { cluster: "devnet", token: { symbol: "WLEND" }, agent: { name: "The Window Lender" } },
  useLaunch: () => ({ data: { kind: "ok", state: { progress: 0.029 } } }),
}));
vi.mock("../../lib/pyth", () => ({
  FEEDS: { "Equity.US.TSLA/USD": "16da" },
  useUnderlying: () => ({ data: { price: 36991n, expo: -2, publishTime: Math.floor(Date.now() / 1000) - 20 } }),
}));
/** Keyed by provider, because two listings share the `prestocks` mechanism tag. */
const quotes: Record<string, unknown> = {
  pyth: null,
  prestocks: { price: 105143999341n, expo: -8, publishTime: Math.floor(Date.now() / 1000) - 3600 },
  jupiter: { price: 35127284640n, expo: -8, publishTime: Math.floor(Date.now() / 1000) - 30 },
};
const coin = vi.fn(() => ({ data: null, isError: false }) as { data: { supply: number } | null; isError: boolean });
vi.mock("../../lib/queries", () => ({
  useDeployment: () => ({
    data: {
      listings: [
        { key: "mock_tsla", source: "pyth", provider: null },
        { key: "prestocks_anthropic", source: "prestocks", provider: "prestocks" },
        // Same `source` as the one above — the tile lookup must tell them apart by provider.
        { key: "xstocks_tslax", source: "prestocks", provider: "jupiter", sourceSymbol: "TSLAx" },
      ],
    },
  }),
  useQuote: (l: { source: string; provider?: string | null } | undefined) => ({
    data: l ? quotes[l.provider ?? l.source] : null,
  }),
  // The Clawpump tile reads the identity coin from mainnet rather than trusting the record.
  useMainnetMint: () => coin(),
}));
const { Integrations } = await import("./Integrations");

describe("the built-with strip", () => {
  it("names every integration with a live number each and a place to go", () => {
    const { container } = render(<Integrations />);
    const t = container.textContent ?? "";
    for (const n of ["Pyth", "PreStocks", "Jupiter", "Meteora DBC", "Clawpump"]) expect(t).toContain(n);
    expect(container.querySelectorAll("[data-integration]")).toHaveLength(5);
    expect(t).toContain("$369.91"); // Pyth: the equity feed while the wrapper cache is empty
    expect(t).toContain("$1,051.44"); // PreStocks: the on-chain mark
    expect(t).toContain("$351.27"); // Jupiter: the traded mark — the one the chain currently accepts
    expect(t).toContain("2.9 %"); // Meteora: progress
    expect(t).toContain("The Window Lender"); // Clawpump: the identity, while the mint has not answered
    expect(container.querySelector('a[href="#/agent"]')).not.toBeNull();
    expect(container.querySelector('a[href="#/market/prestocks"]')).not.toBeNull();
    expect(container.querySelector('a[href="#/market/jupiter"]')).not.toBeNull();
    expect(t).not.toContain("NaN");
  });
  // The strip used to find its PreStocks tile with `source === "prestocks"`, which matches every
  // attested mark; it returned whichever came first and would have labelled a Jupiter-read price
  // as ANTHROPIC's the moment the schedule was reordered.
  it("tells two listings that share a mechanism apart by their provider", () => {
    const { container } = render(<Integrations />);
    const tile = (name: string) => container.querySelector(`[data-integration="${name}"]`)?.textContent ?? "";
    expect(tile("PreStocks")).toContain("$1,051.44");
    expect(tile("PreStocks")).not.toContain("$351.27");
    expect(tile("Jupiter")).toContain("$351.27");
    expect(tile("Jupiter")).not.toContain("$1,051.44");
  });
});

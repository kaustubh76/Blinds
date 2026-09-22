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
const quotes: Record<string, unknown> = {
  pyth: null,
  prestocks: { price: 105143999341n, expo: -8, publishTime: Math.floor(Date.now() / 1000) - 3600 },
};
vi.mock("../../lib/queries", () => ({
  useDeployment: () => ({ data: { listings: [{ source: "pyth" }, { source: "prestocks" }] } }),
  useQuote: (l: { source: string } | undefined) => ({ data: l ? quotes[l.source] : null }),
}));
const { Integrations } = await import("./Integrations");

describe("the built-with strip", () => {
  it("names the four integrations with a live number each and a place to go", () => {
    const { container } = render(<Integrations />);
    const t = container.textContent ?? "";
    for (const n of ["Pyth", "PreStocks", "Meteora DBC", "Clawpump"]) expect(t).toContain(n);
    expect(container.querySelectorAll("[data-integration]")).toHaveLength(4);
    expect(t).toContain("$369.91"); // Pyth: the equity feed while the wrapper cache is empty
    expect(t).toContain("$1,051.44"); // PreStocks: the on-chain mark
    expect(t).toContain("2.9 %"); // Meteora: progress
    expect(t).toContain("The Window Lender"); // Clawpump: the identity
    expect(container.querySelector('a[href="#/agent"]')).not.toBeNull();
    expect(container.querySelector('a[href="#/market/prestocks"]')).not.toBeNull();
    expect(t).not.toContain("NaN");
  });
});

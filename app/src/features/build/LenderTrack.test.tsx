import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const record = {
  cluster: "devnet",
  quote: { mint: "Q", decimals: 8, usd: 365 },
  numbers: { migrationUsd: 250_000, feeBps: { open: 300, rest: 30, periods: 48, durationSecs: 14400 } },
  token: { symbol: "WLEND" },
  pool: "EZyMqXWBk5Z5jLnrZJ1NM8AseSmFaRvn2XSKZSrv6BTg",
  agent: { id: "a", name: "The Window Lender", walletAddress: "W" },
};
const query = vi.fn();
vi.mock("../../lib/launch", () => ({ LAUNCH: record, useLaunch: () => query() }));
const { LenderTrack } = await import("./LenderTrack");

describe("the lender agent's column on the Build page", () => {
  it("names the SDK calls, the record and the honest limit whatever the pool says", () => {
    query.mockReturnValue({ data: { kind: "missing" }, isError: false });
    const { container } = render(<LenderTrack />);
    const t = container.textContent ?? "";
    expect(t).toContain("sdk.fetchDbc");
    expect(t).toContain("sdk.dbcFeeAt");
    expect(t).toContain("deployments/launch-devnet.json");
    expect(t).toContain("pool not on chain yet");
    expect(t).toContain("pump.fun");
    expect(t).toContain("The Window Lender");
  });
  it("shows the live line with a deep link to the card", () => {
    const now = Math.floor(Date.now() / 1000);
    query.mockReturnValue({
      isError: false,
      data: {
        kind: "ok",
        state: {
          progress: 0.0288,
          raisedQuote: 4.85,
          thresholdQuote: 168.5,
          pool: { activationPoint: BigInt(now - 7 * 300 - 5) },
          config: {
            baseFee: { cliffBps: 300, mode: 1, numberOfPeriod: 48, periodFrequency: 300, reductionFactor: 468 },
          },
        },
      },
    });
    const { container } = render(<LenderTrack />);
    const t = container.textContent ?? "";
    expect(t).toContain("2.9 %");
    expect(t).toContain("period 7 of 48");
    expect(container.querySelector('a[href="#/market/lender"]')).not.toBeNull();
  });
});

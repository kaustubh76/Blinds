import { describe, expect, it } from "vitest";
import { buildPlan, DEFAULTS } from "../src/plan.js";

describe("the lender agent's launch plan", () => {
  const tslax = { quoteUsd: 365.23, quoteDecimals: 8 as const };

  it("expresses the USD targets in the quote stock through the Pyth price", () => {
    const p = buildPlan({ ...DEFAULTS, ...tslax });
    expect(p.summary.initialMarketCapQuote).toBeCloseTo(25_000 / 365.23, 6);
    expect(p.summary.migrationMarketCapQuote).toBeCloseTo(250_000 / 365.23, 6);
    // the SDK derives a threshold in quote lamports (8 dp) that scales with the migration cap
    const threshold = Number(p.config.migrationQuoteThreshold.toString()) / 1e8;
    expect(threshold).toBeGreaterThan(0);
    expect(threshold).toBeLessThan(p.summary.migrationMarketCapQuote);
    expect(p.config.curve.length).toBeGreaterThan(0);
  });

  it("scales the raise with the quote price, not with the token count", () => {
    const cheap = buildPlan({ ...DEFAULTS, quoteUsd: 100, quoteDecimals: 8 });
    const dear = buildPlan({ ...DEFAULTS, quoteUsd: 400, quoteDecimals: 8 });
    const t = (p: ReturnType<typeof buildPlan>) => Number(p.config.migrationQuoteThreshold.toString());
    expect(t(cheap) / t(dear)).toBeCloseTo(4, 1);
  });

  it("decays the fee over one tenor, locks all graduated liquidity, pays the agent a slice of the raise", () => {
    const p = buildPlan({ ...DEFAULTS, ...tslax });
    expect(p.summary.feeBps).toEqual({ open: 300, rest: 30, periods: 48, durationSecs: 4 * 3600 });
    expect(
      p.config.partnerPermanentLockedLiquidityPercentage + p.config.creatorPermanentLockedLiquidityPercentage,
    ).toBe(100);
    expect(p.config.partnerLiquidityPercentage + p.config.creatorLiquidityPercentage).toBe(0);
    expect(p.config.migrationFee.feePercentage).toBe(10);
    expect(p.config.migrationFee.creatorFeePercentage).toBe(100);
    expect(p.config.creatorTradingFeePercentage).toBe(50);
  });

  it("refuses nonsense", () => {
    expect(() => buildPlan({ ...DEFAULTS, quoteUsd: 0, quoteDecimals: 8 })).toThrow();
    expect(() => buildPlan({ ...DEFAULTS, ...tslax, migrationUsd: 1, initialUsd: 2 })).toThrow();
  });
});

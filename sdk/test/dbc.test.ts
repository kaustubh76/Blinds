import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dbcFeeAt, dbcPrice, decodeDbcConfig, decodeDbcPool } from "../src/dbc.js";

// The lender agent's devnet pool (EZyMqXWBk5Z5jLnrZJ1NM8AseSmFaRvn2XSKZSrv6BTg) after one 5-quote buy,
// captured 2026-09-21; expected values are what Meteora's own SDK decoded (`window-launch status`).
const b64 = (f: string) =>
  new Uint8Array(Buffer.from(readFileSync(new URL(`./fixtures/${f}`, import.meta.url), "utf8").trim(), "base64"));

describe("Meteora DBC accounts, decoded from raw bytes", () => {
  it("reads the pool the way the SDK does", () => {
    const p = decodeDbcPool(b64("dbc_pool_devnet.b64"));
    expect(p.baseMint).toBe("72QJmsn48nkLKM6zDr5hjVvoEuJGrRRtS81iv8geZL1m");
    expect(p.creator).toBe("8S6dkUV5uby7raYz9aoqHBLDdCL3LvSikyYR5BjkwHf5");
    expect(Number(p.quoteReserve) / 1e8).toBeCloseTo(4.85, 8);
    expect(Number(p.creatorQuoteFee) / 1e8).toBeCloseTo(0.06, 8);
    expect(Number(p.partnerQuoteFee) / 1e8).toBeCloseTo(0.06, 8);
    expect(Number(p.totalTradingQuoteFee) / 1e8).toBeCloseTo(0.12, 8);
    expect(p.isMigrated).toBe(false);
    expect(p.migrationProgress).toBe(0);
    expect(p.sqrtPrice).toBeGreaterThan(0n);
    expect(Number(p.activationPoint)).toBe(1789970389); // 2026-09-21T05:59:49Z, the launch minute
    expect(p.finishCurveTimestamp).toBe(0n);
    expect(p.hasSwap).toBe(true);
  });

  it("reads the fee schedule the plan asked for: 300 → 30 bp over 48 periods of 300 s", () => {
    const c = decodeDbcConfig(b64("dbc_config_devnet.b64"));
    expect(c.feeClaimer).toBe("8S6dkUV5uby7raYz9aoqHBLDdCL3LvSikyYR5BjkwHf5");
    expect(c.baseFee).toEqual({
      cliffBps: 300,
      mode: 1,
      numberOfPeriod: 48,
      periodFrequency: 300,
      reductionFactor: 468,
    });
    const start = 1789970389;
    const at0 = dbcFeeAt(c.baseFee, start, start + 10);
    expect(at0).toMatchObject({ bps: 300, period: 0, periodsLeft: 48, secsToNext: 290 });
    expect(at0.restingBps).toBeCloseTo(30, 0);
    const mid = dbcFeeAt(c.baseFee, start, start + 7 * 300 + 5);
    expect(mid.period).toBe(7);
    expect(mid.bps).toBeCloseTo(300 * 0.9532 ** 7, 6);
    expect(mid.secsToNext).toBe(295);
    const done = dbcFeeAt(c.baseFee, start, start + 5 * 3600);
    expect(done).toMatchObject({ period: 48, periodsLeft: 0, secsToNext: 0 });
    expect(done.bps).toBeCloseTo(done.restingBps, 9);
    // before activation the cliff applies
    expect(dbcFeeAt(c.baseFee, start, start - 100).bps).toBe(300);
  });

  it("evaluates a linear schedule and clamps at zero", () => {
    const fee = { cliffBps: 100, mode: 0, numberOfPeriod: 10, periodFrequency: 60, reductionFactor: 15 };
    expect(dbcFeeAt(fee, 0, 0).bps).toBe(100);
    expect(dbcFeeAt(fee, 0, 3 * 60).bps).toBe(55);
    expect(dbcFeeAt(fee, 0, 3600).bps).toBe(0);
    expect(dbcFeeAt({ ...fee, numberOfPeriod: 0 }, 0, 3600)).toMatchObject({ bps: 100, periodsLeft: 0 });
  });

  it("reads the config's threshold and price bounds", () => {
    const c = decodeDbcConfig(b64("dbc_config_devnet.b64"));
    expect(c.quoteMint).toBe("GY41SK2WptpFx6C4jiXACtHJC8zZVhpJd5voWPNfqhbn");
    expect(Number(c.migrationQuoteThreshold) / 1e8).toBeCloseTo(168.50157355, 6);
    expect(c.migrationSqrtPrice).toBeGreaterThan(c.sqrtStartPrice);
    const p = decodeDbcPool(b64("dbc_pool_devnet.b64"));
    expect(p.sqrtPrice).toBeGreaterThanOrEqual(c.sqrtStartPrice);
    // the pool's spot price after the buy sits between start and graduation, in quote per base
    const price = dbcPrice(p.sqrtPrice, 6, 8);
    expect(price).toBeGreaterThan(dbcPrice(c.sqrtStartPrice, 6, 8));
    expect(price).toBeLessThan(dbcPrice(c.migrationSqrtPrice, 6, 8));
  });

  it("refuses other accounts", () => {
    expect(() => decodeDbcPool(b64("dbc_config_devnet.b64"))).toThrow(/not a DBC pool/);
  });
});

/**
 * The creator's fee share decides whether a pool's earnings can reach a wallet nobody here can sign
 * for. The devnet rehearsal kept 50 % with its creator; the mainnet pool keeps none, so everything
 * reaches the fee claimer. The offset was found by matching both clusters' live accounts.
 */
describe("the creator's fee share", () => {
  /**
   * Both halves, because either alone would pass at the wrong offset: the devnet config carries 50 at
   * more than one plausible byte, and only the mainnet config distinguishes them by carrying 0. These
   * are the live accounts of the two pools, captured from the chain.
   */
  it("reads 50 on the devnet rehearsal and 0 on the mainnet pool", () => {
    expect(decodeDbcConfig(b64("dbc_config_devnet.b64")).creatorTradingFeePercentage).toBe(50);
    expect(decodeDbcConfig(b64("dbc_config_mainnet.b64")).creatorTradingFeePercentage).toBe(0);
  });

  it("reads the mainnet pool's fee claimer, which is the agent's wallet", () => {
    expect(decodeDbcConfig(b64("dbc_config_mainnet.b64")).feeClaimer).toBe(
      "39VKQn2Skp67mFYfiFfvRLEKsxaTtHqQWRop5q9cA7sM",
    );
  });
});

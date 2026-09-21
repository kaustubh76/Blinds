import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dbcPrice, decodeDbcConfig, decodeDbcPool } from "../src/dbc.js";

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

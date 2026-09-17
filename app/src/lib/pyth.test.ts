import { describe, expect, it } from "vitest";
import { basisBps, decodePriceUpdate, FEEDS, formatBasis, hexToBytes, nyseSession, pushOraclePda } from "./pyth";

/** services/admin/tests/fixtures/pyth_tslax_usd_mainnet.bin — mainnet GpoWLTd6… captured 2026-09-16. */
const TSLAX_ACCOUNT =
  "IvEjY51+9M3rHi+pfZKcEq8z9y+7+0jTHePaYmisK6k/GeGQ3sZbmwFHoVZHAoiFCkQN86bOhaVZF7gToZu1sxEoozqYZWajYsHA8IAIAAAAfjSCAAAAAAD4////LkOlagAAAAAtQ6VqAAAAAIZOFYEIAAAATMl+AAAAAAA78psaAAAAAAA=";
const bytes = Uint8Array.from(atob(TSLAX_ACCOUNT), (c) => c.charCodeAt(0));

describe("decodePriceUpdate", () => {
  it("decodes the mainnet TSLAX account exactly as the keeper does", () => {
    const p = decodePriceUpdate(bytes, FEEDS["Crypto.TSLAX/USD"]);
    expect(p.price).toBe(36_523_000_001n);
    expect(p.expo).toBe(-8);
    expect(p.publishTime).toBe(1_789_215_534);
    expect(p.verification).toBe("full");
  });
  it("rejects another feed, truncated data and an unknown verification level", () => {
    expect(() => decodePriceUpdate(bytes, FEEDS["Equity.US.TSLA/USD"])).toThrow(/carries feed/);
    expect(() => decodePriceUpdate(bytes.subarray(0, 40), FEEDS["Crypto.TSLAX/USD"])).toThrow(/too short/);
    const bad = Uint8Array.from(bytes);
    bad[40] = 7;
    expect(() => decodePriceUpdate(bad, FEEDS["Crypto.TSLAX/USD"])).toThrow(/verification level/);
  });
});

describe("pushOraclePda", () => {
  it("derives the mainnet accounts for shards 0 and 1", async () => {
    expect(await pushOraclePda(0, FEEDS["Crypto.TSLAX/USD"])).toBe("GpoWLTd6GoisYxYgHz7mTcZvgnfJu4SN7T6PxWjgUTFY");
    expect(await pushOraclePda(1, FEEDS["Crypto.TSLAX/USD"])).toBe("Exzs9zruUELRmPAn6SzzLiqx5wpkVJ8cghTQnF8wSCXP");
    expect(await pushOraclePda(1, FEEDS["Equity.US.TSLA/USD"])).toBe("FQB8c4zB8Emrp9W8bmyk6GanCLq4aRytHYPDAnaEpq9z");
  });
  it("round-trips hex", () => {
    expect(hexToBytes("0x00ff10")).toEqual(new Uint8Array([0, 255, 16]));
  });
});

describe("basis and session", () => {
  it("measures the wrapper against the underlying in bp", () => {
    const under = { price: 36_525_500n, expo: -5 }; // 365.255
    const wrap = { price: 36_523_000_001n, expo: -8 }; // 365.23000001
    expect(basisBps(wrap, under)).toBeCloseTo(-0.684, 2);
    expect(formatBasis(basisBps(wrap, under))).toBe("−0.7 bp");
    expect(formatBasis(12.34)).toBe("+12.3 bp");
    expect(basisBps(wrap, { price: 0n, expo: 0 })).toBe(0);
  });
  it("knows NYSE regular hours in New York time", () => {
    // 2026-09-17 is a Thursday. 13:30Z = 09:30 EDT (open); 19:59Z = 15:59 (open); 20:00Z = 16:00 (closed).
    expect(nyseSession(new Date("2026-09-17T13:29:59Z")).open).toBe(false);
    expect(nyseSession(new Date("2026-09-17T13:30:00Z")).open).toBe(true);
    expect(nyseSession(new Date("2026-09-17T19:59:00Z")).open).toBe(true);
    expect(nyseSession(new Date("2026-09-17T20:00:00Z")).open).toBe(false);
    expect(nyseSession(new Date("2026-09-19T15:00:00Z")).open).toBe(false); // Saturday
    expect(nyseSession(new Date("2026-09-19T15:00:00Z")).label).toBe("outside regular hours");
  });
});

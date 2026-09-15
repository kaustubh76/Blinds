import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { bpsToTick, clear, emptyCurve, TICKS, tickToBps } from "../src/rates.js";

// The same fixtures as crates/window-clearing/fixtures/clearing.json: Rust and TS agree by construction.
const fixtures = JSON.parse(
  readFileSync(new URL("../../crates/window-clearing/fixtures/clearing.json", import.meta.url), "utf8"),
) as {
  cases: Array<{
    name: string;
    asks: Record<string, number>;
    bids: Record<string, number>;
    expect: null | { r_star: number; matched: number; marginal_tick: number; marginal_ratio: [number, number] };
  }>;
};

describe("rates", () => {
  it("tick math", () => {
    expect(tickToBps(0)).toBe(100);
    expect(tickToBps(36)).toBe(1000);
    expect(bpsToTick(325)).toBe(9);
    expect(() => tickToBps(TICKS)).toThrow();
  });
  for (const c of fixtures.cases) {
    it(`fixture: ${c.name}`, () => {
      const curve = emptyCurve();
      for (const [t, v] of Object.entries(c.asks)) curve.ask[Number(t)] = BigInt(v);
      for (const [t, v] of Object.entries(c.bids)) curve.bid[Number(t)] = BigInt(v);
      const got = clear(curve);
      if (c.expect === null) {
        expect(got).toBeNull();
      } else {
        expect(got?.rStar).toBe(c.expect.r_star);
        expect(got?.matched).toBe(BigInt(c.expect.matched));
        expect(got?.marginalTick).toBe(c.expect.marginal_tick);
        expect(got?.marginalRatio).toEqual({
          num: BigInt(c.expect.marginal_ratio[0]),
          den: BigInt(c.expect.marginal_ratio[1]),
        });
      }
    });
  }
});

import { describe, expect, it } from "vitest";
import {
  collateralPledge,
  collateralRequired,
  multiplierScaled,
  priceCents,
  scalarBoundOk,
  solvencyScalars,
} from "../src/solvency.js";

describe("solvency scalars (A3, mirrors crates/window-proofs scalar.rs)", () => {
  it("scales price and multiplier", () => {
    expect(priceCents(40_012_000_000n, -8)).toBe(40_012n);
    expect(priceCents(400n, -2)).toBe(400n);
    expect(multiplierScaled(1)).toBe(1_000n);
    expect(multiplierScaled(1.0125)).toBe(1_013n);
  });
  it("k_c = p'·a, k_l = haircut/100, within the soundness bound", () => {
    const s = solvencyScalars(40_012n, 1_000n, 15_000n);
    expect(s).toEqual({ kC: 40_012_000n, kL: 150n });
    expect(scalarBoundOk(s)).toBe(true);
    expect(() => solvencyScalars(40_012n, 1_000n, 9_000n)).toThrow();
  });
  it("collateral requirement: c·p'·a ≥ 150·ℓ (1,000 USDC at $400.12 → 3.749 shares)", () => {
    const s = solvencyScalars(40_012n, 1_000n, 15_000n);
    const c = collateralRequired(1_000_000_000n, s);
    expect(c).toBe(3_749n);
    expect(c * s.kC >= 1_000_000_000n * s.kL).toBe(true);
    expect((c - 1n) * s.kC >= 1_000_000_000n * s.kL).toBe(false);
    expect(collateralPledge(1_000_000_000n, s)).toBeGreaterThan(c);
  });
});

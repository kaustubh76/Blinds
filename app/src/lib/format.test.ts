import { describe, expect, it } from "vitest";
import { formatShares, formatUsdc, multiplierScaled, parseUnits, priceCents } from "./format";

describe("format", () => {
  it("scales prices to cents per amendment A3", () => {
    expect(priceCents(40_012_000_000n, -8)).toBe(40_012n);
    expect(priceCents(400n, -2)).toBe(400n);
    expect(priceCents(4n, 0)).toBe(400n);
  });
  it("scales the multiplier to 10^-3", () => {
    expect(multiplierScaled(1)).toBe(1_000n);
    expect(multiplierScaled(1.0125)).toBe(1_013n);
  });
  it("parses and formats units", () => {
    expect(parseUnits("1000", 6)).toBe(1_000_000_000n);
    expect(parseUnits("12.5", 3)).toBe(12_500n);
    expect(parseUnits("abc", 3)).toBeNull();
    expect(formatUsdc(1_500_000_000n)).toBe("1,500 USDC");
    expect(formatShares(12_500n)).toBe("12.500");
  });
});

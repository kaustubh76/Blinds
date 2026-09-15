import { describe, expect, it } from "vitest";
import { formatShares, formatUsdc, parseUnits } from "./format";

describe("format", () => {
  it("parses and formats units", () => {
    expect(parseUnits("1000", 6)).toBe(1_000_000_000n);
    expect(parseUnits("12.5", 3)).toBe(12_500n);
    expect(parseUnits("abc", 3)).toBeNull();
    expect(formatUsdc(1_500_000_000n)).toBe("1,500 USDC");
    expect(formatShares(12_500n)).toBe("12.500");
  });
});

import { describe, expect, it } from "vitest";
import { capitalize, countWord, formatShares, formatUsdc, parseUnits } from "./format";

describe("format", () => {
  it("parses and formats units", () => {
    expect(parseUnits("1000", 6)).toBe(1_000_000_000n);
    expect(parseUnits("12.5", 3)).toBe(12_500n);
    expect(parseUnits("abc", 3)).toBeNull();
    expect(formatUsdc(1_500_000_000n)).toBe("1,500 USDC");
    expect(formatShares(12_500n)).toBe("12.500");
  });
});

describe("countWord", () => {
  it("spells small counts and opens a sentence", () => {
    expect(countWord(0)).toBe("no");
    expect(countWord(1)).toBe("one");
    expect(capitalize(countWord(2))).toBe("Two");
  });

  // The list this replaced ran out at four and dropped a bare digit into the middle of a sentence.
  it("keeps spelling past the old list, and falls back to digits rather than breaking", () => {
    expect(countWord(5)).toBe("five");
    expect(countWord(10)).toBe("ten");
    expect(countWord(11)).toBe("11");
    expect(capitalize(countWord(23))).toBe("23");
  });

  it("leaves an empty string alone", () => {
    expect(capitalize("")).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { capitalize, countWord, displaySymbol, formatShares, formatUsdc, parseUnits } from "./format";

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

describe("displaySymbol", () => {
  it("keeps the chain's bytes and reports the twin suffix separately", () => {
    // The suffix used to be dropped silently in eight places, so a bare `TSLAx` sat beside a
    // live-looking price with nothing saying the mint is a devnet twin of the real one.
    expect(displaySymbol({ symbol: "TSLAx-mock" })).toEqual({ label: "TSLAx", twin: true });
    expect(displaySymbol({ symbol: "ANTHROPIC-mock" })).toEqual({ label: "ANTHROPIC", twin: true });
  });

  it("leaves a symbol that is not a twin exactly as the chain holds it", () => {
    // The two TSLAx listings must stay distinguishable: one is Pyth-marked, one is traded-marked,
    // and the schedule is the only place a reader can tell them apart.
    expect(displaySymbol({ symbol: "TSLAx-xs" })).toEqual({ label: "TSLAx-xs", twin: false });
    expect(displaySymbol({ symbol: "TSLAx" })).toEqual({ label: "TSLAx", twin: false });
    // `-mock` anywhere but the end is part of the name.
    expect(displaySymbol({ symbol: "mock-TSLAx" })).toEqual({ label: "mock-TSLAx", twin: false });
  });
});

import { describe, expect, it } from "vitest";
import { capitalize, countWord, displaySymbol, formatShares, formatUsdc, parseUnits } from "./format";
import { isTwinCluster } from "./listings";

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
  it("drops the suffix a devnet twin's mint carries, and nothing else", () => {
    expect(displaySymbol({ symbol: "TSLAx-mock" })).toBe("TSLAx");
    expect(displaySymbol({ symbol: "ANTHROPIC-mock" })).toBe("ANTHROPIC");
    // `-mock` anywhere but the end is part of the name.
    expect(displaySymbol({ symbol: "mock-TSLAx" })).toBe("mock-TSLAx");
  });

  it("keeps every other suffix, because the desk lists one stock twice", () => {
    // One TSLAx is Pyth-marked and one is traded-marked. The schedule is the only place a reader
    // can tell them apart, so stripping `-xs` would make two different collaterals read alike.
    expect(displaySymbol({ symbol: "TSLAx-xs" })).toBe("TSLAx-xs");
    expect(displaySymbol({ symbol: "TSLAx" })).toBe("TSLAx");
  });

  it("does not answer whether the mint is a twin — the cluster does", () => {
    // It used to return `{ label, twin }` and decide twin-ness from the suffix, so `TSLAx-xs`
    // rendered with no marker beside a live price while `TSLAx-mock` got one. A suffix is a naming
    // convention; the cluster the mint was created on is the evidence.
    expect(isTwinCluster("devnet")).toBe(true);
    expect(isTwinCluster("localnet")).toBe(true);
    expect(isTwinCluster("mainnet-beta")).toBe(false);
  });
});

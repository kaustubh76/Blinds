import { describe, expect, it } from "vitest";
import {
  feedIdForLabel,
  isAttestedMark,
  PRICE_SOURCE_NAMES,
  PriceSource,
  priceSourceTag,
  quoteFreshness,
} from "../src/listings.js";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("collateral schedule helpers", () => {
  it("labels a non-Pyth listing's feed id exactly as crates/window-config does", async () => {
    // Same vector as `devnet_lists_the_prestocks_mark_under_a_label_not_a_pyth_id`.
    expect(hex(await feedIdForLabel("prestocks:ANTHROPIC"))).toBe(
      "8bd733112c944281b9caeefc1728d935b10b95a8809bb70c11214a86fb6a89eb",
    );
    expect(hex(await feedIdForLabel("prestocks:ANTHROPIC"))).not.toBe(hex(await feedIdForLabel("prestocks:SPACEX")));
  });

  it("names sources and knows which are attested marks", () => {
    expect(PRICE_SOURCE_NAMES[PriceSource.Pyth]).toBe("Pyth");
    expect(isAttestedMark(PriceSource.Mark)).toBe(true);
    expect(isAttestedMark(PriceSource.Reserved1)).toBe(false);
    expect(PRICE_SOURCE_NAMES[PriceSource.Reserved1]).toBe("retired mark");
    expect(isAttestedMark(PriceSource.Pyth)).toBe(false);
    expect(isAttestedMark(PriceSource.Mock)).toBe(false);
    // Tag 2 is the mechanism; which provider a listing reads is a descriptor fact, not a chain one,
    // so the chain's own vocabulary stops at "attested mark".
    expect(PRICE_SOURCE_NAMES[PriceSource.Mark]).toBe("attested mark");
  });

  it("evaluates both on-chain freshness rules at their boundaries", () => {
    const listing = { maxPriceAge: 1_200n, maxPublishAgeSecs: 3_600n };
    const price = { postedSlot: 10_000n, publishTime: 1_789_000_000n };
    const ok = quoteFreshness({ listing, price, slot: 11_200, nowSecs: 1_789_003_600 });
    expect(ok).toEqual({
      postedAgeSlots: 1_200,
      quoteAgeSecs: 3_600,
      postedFresh: true,
      quoteFresh: true,
      usable: true,
    });
    expect(quoteFreshness({ listing, price, slot: 11_201, nowSecs: 1_789_003_600 }).usable).toBe(false);
    expect(quoteFreshness({ listing, price, slot: 11_200, nowSecs: 1_789_003_601 }).quoteFresh).toBe(false);
    // clocks behind the quote never go negative
    expect(quoteFreshness({ listing, price, slot: 9_000, nowSecs: 1_000 }).postedAgeSlots).toBe(0);
  });
});

describe("priceSourceTag", () => {
  it("maps every label a profile can write, including the honest spelling of tag 2", () => {
    expect(priceSourceTag("pyth")).toBe(PriceSource.Pyth);
    expect(priceSourceTag("prestocks")).toBe(PriceSource.Mark);
    expect(priceSourceTag("mark")).toBe(PriceSource.Mark);
    expect(priceSourceTag("mock")).toBe(PriceSource.Mock);
    expect(priceSourceTag("reserved")).toBe(PriceSource.Reserved1);
  });

  it("throws on a label it does not know", () => {
    // It used to return `Mock`, so an unrecognised source rendered as "mock walk" beside a real
    // price — an answer to a question the descriptor had not been asked.
    expect(() => priceSourceTag("switchboard")).toThrow(/unknown price source/);
    expect(() => priceSourceTag("")).toThrow();
  });
});

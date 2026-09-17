import { describe, expect, it } from "vitest";
import { feedIdForLabel, isAttestedMark, PRICE_SOURCE_NAMES, PriceSource, quoteFreshness } from "../src/listings.js";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

describe("collateral schedule helpers", () => {
  it("labels a non-Pyth listing's feed id exactly as crates/window-config does", async () => {
    // Same vectors as `devnet_lists_tessera_and_prestocks_marks_under_labels_not_pyth_ids`.
    expect(hex(await feedIdForLabel("tessera:T-OpenAI"))).toBe(
      "a217fe4a7ea1f0fcc0c7c5100e749940ab3c0478eefdeefac438b62f4956f13a",
    );
    expect(hex(await feedIdForLabel("prestocks:ANTHROPIC"))).toBe(
      "8bd733112c944281b9caeefc1728d935b10b95a8809bb70c11214a86fb6a89eb",
    );
    expect(hex(await feedIdForLabel("tessera:T-OpenAI"))).not.toBe(hex(await feedIdForLabel("prestocks:ANTHROPIC")));
  });

  it("names sources and knows which are attested marks", () => {
    expect(PRICE_SOURCE_NAMES[PriceSource.Pyth]).toBe("Pyth");
    expect(isAttestedMark(PriceSource.Tessera)).toBe(true);
    expect(isAttestedMark(PriceSource.PreStocks)).toBe(true);
    expect(isAttestedMark(PriceSource.Pyth)).toBe(false);
    expect(isAttestedMark(PriceSource.Mock)).toBe(false);
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

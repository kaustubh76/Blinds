/**
 * How a listing's source is named on screen. Tag 2 is a mechanism two listings share, so the
 * label has to come from the provider the descriptor records — not from the mechanism, which
 * would put the wrong company beside a price.
 */
import { PriceSource } from "@thewindow/solana-sdk";
import { describe, expect, it } from "vitest";
import type { ListingView } from "./chain";
import { sourceLabel } from "./listings";

const listing = (over: Partial<ListingView>): Pick<ListingView, "source" | "priceSource" | "provider"> => ({
  source: "prestocks",
  priceSource: PriceSource.Mark,
  provider: null,
  ...over,
});

describe("sourceLabel", () => {
  it("names the provider an attested mark actually reads", () => {
    expect(sourceLabel(listing({ provider: "jupiter" }))).toBe("Jupiter mark");
    expect(sourceLabel(listing({ provider: "prestocks" }))).toBe("PreStocks mark");
  });

  it("keeps a provider it has not met, lowercase, rather than guessing a nicer name", () => {
    expect(sourceLabel(listing({ provider: "someone-else" }))).toBe("someone-else mark");
  });

  it("falls back to the mechanism when no provider was recorded", () => {
    // A descriptor written before providers were told apart says only this much, and saying
    // "PreStocks" here would have been a guess about which API was read.
    expect(sourceLabel(listing({}))).toBe("attested mark");
  });

  it("says so when the program reads Pyth's own account rather than the keeper's cache", () => {
    expect(sourceLabel(listing({ source: "pyth", priceSource: PriceSource.PythAccount }))).toBe("Pyth · on-chain");
  });

  it("names Pyth and the mock walk from the tag", () => {
    expect(sourceLabel(listing({ source: "pyth", priceSource: PriceSource.Pyth }))).toBe("Pyth");
    expect(sourceLabel(listing({ source: "mock", priceSource: PriceSource.Mock }))).toBe("mock walk");
  });
});

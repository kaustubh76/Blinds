import { describe, expect, it } from "vitest";
import { parseHash, toHash } from "./useHashRoute";

describe("hash route", () => {
  it("round-trips tabs and parameters", () => {
    expect(parseHash("#/explorer/16")).toEqual({ tab: "explorer", param: "16" });
    expect(parseHash("#/desk")).toEqual({ tab: "desk" });
    expect(parseHash("#/build")).toEqual({ tab: "build" });
    expect(toHash("explorer", "16")).toBe("#/explorer/16");
    expect(toHash("market")).toBe("#/market");
  });
  it("falls back to the market", () => {
    expect(parseHash("")).toEqual({ tab: "market" });
    expect(parseHash("#/nope/3")).toEqual({ tab: "market", param: "3" });
  });
});

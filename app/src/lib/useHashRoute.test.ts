import { describe, expect, it } from "vitest";
import { parseHash, toHash } from "./useHashRoute";

describe("hash route", () => {
  it("round-trips tabs and parameters", () => {
    expect(parseHash("#/explorer/16")).toEqual({ tab: "explorer", param: "16" });
    expect(parseHash("#/desk")).toEqual({ tab: "desk" });
    expect(parseHash("#/build")).toEqual({ tab: "build" });
    expect(parseHash("#/agent")).toEqual({ tab: "agent" });
    expect(toHash("explorer", "16")).toBe("#/explorer/16");
    expect(toHash("market")).toBe("#/market");
  });
  it("ignores a query inside the hash", () => {
    expect(parseHash("#/market?theme=dark")).toEqual({ tab: "market" });
    expect(parseHash("#/market/lender?rpc=x")).toEqual({ tab: "market", param: "lender" });
  });
  it("falls back to home", () => {
    expect(parseHash("")).toEqual({ tab: "home" });
    expect(parseHash("#/")).toEqual({ tab: "home" });
    expect(parseHash("#/nope/3")).toEqual({ tab: "home", param: "3" });
  });
});

import { render } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const now = Math.floor(Date.now() / 1000);
const feedId = new Uint8Array(32).fill(0xab);
const listing = {
  source: "prestocks",
  symbol: "ANTHROPIC-mock",
  listing: "4qQ4A9111111111111111111111111111111111111",
  escrow: "93myeN111111111111111111111111111111111111",
  cstockMint: "DA7UsQD5zwnVTyEcL1RVc5DsDDokfqx9a6AVSTaP8rNo",
  feedId,
  haircutBps: 20000n,
  maxPublishAgeSecs: 172800,
};
const marks = vi.fn();
vi.mock("../../config", () => ({ config: { cluster: "devnet", adminUrl: "https://admin.example" } }));
vi.mock("../../lib/queries", () => ({
  useDeployment: () => ({ data: { listings: [{ source: "pyth" }, listing] } }),
  useQuote: () => ({ data: { price: 105143999341n, expo: -8, publishTime: now - 600, postedSlot: 100n } }),
  useSlot: () => ({ data: 1000 }),
  useMarks: () => marks(),
}));
const { PreStocksMark, snapshotFor } = await import("./PreStocksMark");

const snap = {
  key: "prestocks_anthropic",
  symbol: "ANTHROPIC-mock",
  source: "prestocks",
  feed_id_hex: "ab".repeat(32),
  url: "https://prestocks.com/api/prestocks",
  mark_e8: 105_143_999_341,
  implied_e8: 103_987_682_509,
  basis_bps: -110,
  fetched_at: now - 30,
};

describe("the PreStocks mark card", () => {
  it("matches the keeper's snapshot on the feed id, never on a name", () => {
    expect(snapshotFor({ x: snap }, "ab".repeat(32))).toBe(snap);
    expect(snapshotFor({ x: snap }, "cd".repeat(32))).toBeNull();
    expect(snapshotFor(null, "ab".repeat(32))).toBeNull();
  });
  it("shows the mark, the implied price and the basis when the keeper answers", () => {
    marks.mockReturnValue({ data: { prestocks_anthropic: snap }, isFetching: false });
    const { container } = render(<PreStocksMark />);
    const t = container.textContent ?? "";
    expect(t).toContain("$1,051.44");
    expect(t).toContain("$1,039.88");
    expect(t).toMatch(/−?-?110 bps|-110|−110/);
    expect(t).toContain("200%");
    expect(t).toContain("attested");
    expect(t).not.toContain("NaN");
  });
  it("says what the implied price waits on when the keeper does not answer", () => {
    marks.mockReturnValue({ data: null, isFetching: false });
    const { container } = render(<PreStocksMark />);
    const t = container.textContent ?? "";
    expect(t).toContain("$1,051.44");
    expect(t).toContain("the keeper did not answer");
    expect(container.querySelector("#prestocks")).not.toBeNull();
  });
});

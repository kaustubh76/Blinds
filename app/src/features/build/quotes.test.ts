import { address } from "@solana/kit";
import { PriceSource, pda } from "@thewindow/solana-sdk";
import { describe, expect, it } from "vitest";
import type { DeploymentView } from "../../lib/chain";
import { quoteAddress, quoteSourceFor } from "./quotes";

const listingPda = address("5pJXoGpvFpJwPFUdyri22Kxv679UmhbRaaiLannC7zGG");
const pythAccount = address("JBDgVnqW7p4Zm8r23AJHTgYUEu4evCt2VppGj3brVuCS");
const feedId = new Uint8Array(32).fill(7);
const dep = { listings: [{ listing: listingPda, priceAccount: pythAccount }] } as unknown as DeploymentView;

describe("quoteSourceFor / quoteAddress", () => {
  it("reads a cache-priced listing from its PriceCache PDA, whatever the descriptor names", async () => {
    const src = quoteSourceFor({ feedId, priceSource: PriceSource.Tessera }, listingPda, dep);
    expect(await quoteAddress(src)).toBe(await pda.priceCache(feedId));
  });

  it("reads a source-4 listing from the Pyth account the descriptor names", async () => {
    const src = quoteSourceFor({ feedId, priceSource: PriceSource.PythAccount }, listingPda, dep);
    expect(src.priceAccount).toBe(pythAccount);
    expect(await quoteAddress(src)).toBe(pythAccount);
  });

  it("says so, instead of falling back to the cache, when a source-4 listing names no account", async () => {
    const src = quoteSourceFor({ feedId, priceSource: PriceSource.PythAccount }, listingPda, null);
    expect(src.priceAccount).toBeNull();
    expect(await quoteAddress(src)).toBeNull();
  });
});

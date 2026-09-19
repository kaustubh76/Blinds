/**
 * The quote a listing prices from, resolved the way the program resolves it: the keeper's cache PDA
 * for sources 0–3, or — for source 4 — the Pyth receiver-owned account the descriptor names
 * (`price_account`; the on-chain `Listing` does not carry it). `fetchQuotes` then reads whichever
 * account that is, so a Build-page reader never shows "no cache" for a listing the chain accepts.
 */
import type { Address } from "@solana/kit";
import { type credit, type QuoteSource, quoteAccount, readsPythAccount } from "@thewindow/solana-sdk";
import type { DeploymentView } from "../../lib/chain";

export function quoteSourceFor(
  chain: Pick<credit.Listing, "feedId" | "priceSource">,
  listingPda: Address,
  deployment: DeploymentView | null,
): QuoteSource {
  const feedId = new Uint8Array(chain.feedId);
  const named = deployment?.listings.find((l) => l.listing === listingPda)?.priceAccount ?? null;
  return { feedId, priceSource: chain.priceSource, priceAccount: named };
}

/** Where the program would read the quote, or `null` when a source-4 listing names no account in this build. */
export async function quoteAddress(src: QuoteSource): Promise<Address | null> {
  if (readsPythAccount(src.priceSource) && !src.priceAccount) return null;
  return quoteAccount(src);
}

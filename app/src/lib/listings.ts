/**
 * The collateral schedule on the dashboard: which listing the desk is working, persisted per
 * browser; the session's token signature follows it (one signature per cSTOCK mint).
 */

import { useQuery } from "@tanstack/react-query";
import { fetchListings, PRICE_SOURCE_NAMES, PriceSource } from "@thewindow/solana-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type ListingView, rpc } from "./chain";
import { useDeployment, usePrices } from "./queries";
import { useSession } from "./wallet";

export const LISTING_KEY = "thewindow:listing";

function readSelected(): string | null {
  try {
    return localStorage.getItem(LISTING_KEY);
  } catch {
    return null;
  }
}

/**
 * The listing the desk works: the saved key, else the first one the chain would accept, else listing
 * #0. Keeps the session's mint in step. The choice is React state (seeded from storage): the
 * descriptor's `listings` array never changes identity, so a memo over it alone would never see a
 * new pick.
 *
 * The fallback follows the chain rather than the schedule's order. Listing #0 is the Pyth-marked
 * TSLAx, and Pyth's own accounts for that feed went stale — so a first-time visitor pressing the
 * hero's one button landed on the Desk holding a collateral no lock could use, and the demo script
 * had to tell a presenter to pick another by hand. A saved pick always wins, and nothing here is
 * persisted: the preference is re-read from the chain on every load.
 */
export function useSelectedListing() {
  const dep = useDeployment();
  const session = useSession();
  const listings = dep.data?.listings ?? [];
  const prices = usePrices(dep.data?.listings);
  const [key, setKey] = useState<string | null>(readSelected);
  const quotes = prices.data;
  const selected = useMemo(() => {
    const saved = listings.find((l) => l.key === key);
    if (saved) return saved;
    const now = Math.floor(Date.now() / 1000);
    const usable = listings.find((l, i) => {
      const q = quotes?.[i];
      return q ? now - Number(q.publishTime) <= l.maxPublishAgeSecs : false;
    });
    return usable ?? listings[0];
  }, [listings, key, quotes]);
  const mint = selected?.cstockMint ?? null;
  const { listing: sessionMint, setListing } = session;
  useEffect(() => {
    if (sessionMint !== mint) setListing(mint);
  }, [mint, sessionMint, setListing]);
  const select = useCallback((next: string) => {
    try {
      localStorage.setItem(LISTING_KEY, next);
    } catch {
      // per-browser convenience only
    }
    setKey(next);
  }, []);
  return { listings, selected, select };
}

/** The listing a loan is bound to (`Loan.listing`), if the descriptor knows it. */
export function listingByPda(listings: ListingView[], pda: string): ListingView | undefined {
  return listings.find((l) => l.listing === pda);
}

/**
 * Whether this deployment's collateral mints are devnet twins of real tokens rather than the tokens
 * themselves. Read from the **cluster**, not from a symbol: every `mock_mint` in a descriptor is
 * created by `setup` on the desk's own cluster, so a `-mock` suffix is a convention while the
 * cluster is the evidence. Keying on the suffix left `TSLAx-xs` unmarked beside a live price.
 */
export const isTwinCluster = (cluster: string): boolean => cluster !== "mainnet-beta";

/**
 * Which provider a listing actually reads. `source` is the *mechanism* and tag 2 is shared by every
 * attested mark, so anything provider-specific — a label, a URL, a tile — must key on this or it
 * names whichever listing happens to come first in the schedule.
 */
export const providerOf = (l: Pick<ListingView, "source" | "provider">): string => l.provider ?? l.source;

/** A listing by provider, or `undefined`. The lookup `source === "prestocks"` used to do this. */
export const byProvider = (listings: ListingView[], provider: string): ListingView | undefined =>
  listings.find((l) => providerOf(l) === provider);

/**
 * Where a reader can see the provider's own answer. Built from what the descriptor records — the
 * mint for a keyed API — rather than from a table that would need an entry per listing.
 */
export function providerUrl(l: Pick<ListingView, "source" | "provider" | "sourceMint">): string | null {
  switch (providerOf(l)) {
    case "prestocks":
      return "https://prestocks.com/api/prestocks";
    case "jupiter":
      return l.sourceMint ? `https://lite-api.jup.ag/price/v3?ids=${l.sourceMint}` : "https://jup.ag";
    case "pyth":
      return "https://www.pyth.network/price-feeds/crypto-tslax-usd";
    default:
      return null;
  }
}

/**
 * The label an attested mark's feed id is the sha256 of: `<provider>:<symbol>`, mirroring
 * `ListingCfg::feed_id` in `crates/window-config`. The symbol is the *provider's* — the real token's
 * — not the devnet twin's, which is why deriving it from the on-chain symbol produced
 * `prestocks:TSLAx-xs`, a label no listing is seeded on.
 */
export const markLabel = (l: Pick<ListingView, "source" | "provider" | "symbol" | "sourceSymbol">): string =>
  `${providerOf(l)}:${l.sourceSymbol ?? l.symbol}`;

/**
 * How an attested mark's provider is written on screen. A provider the desk has not met keeps the
 * label its feed id is seeded on, lowercase — the honest answer, rather than a prettier guess.
 */
/**
 * How a provider is written on screen. A provider the desk has not met keeps the label its feed id
 * is seeded on, lowercase — the honest answer rather than a prettier guess. One map: the Market
 * card's own copy table takes its name from here, so adding a provider is one edit, not two.
 */
export const providerName = (provider: string): string =>
  ({ prestocks: "PreStocks", jupiter: "Jupiter" })[provider] ?? provider;

/**
 * Human label for a listing's source tag or descriptor string. Given a whole listing it prefers the
 * provider, because tag 2 is a mechanism two listings share: naming it "PreStocks mark" off the
 * mechanism alone would put the wrong company beside a Jupiter-read price.
 */
export function sourceLabel(
  source: string | number | Pick<ListingView, "source" | "priceSource" | "provider">,
): string {
  if (typeof source === "object") {
    if (source.priceSource === PriceSource.PythAccount) return "Pyth · on-chain";
    if (source.priceSource === PriceSource.Mark && source.provider) {
      return `${providerName(source.provider)} mark`;
    }
    return sourceLabel(source.source);
  }
  if (typeof source === "number") return PRICE_SOURCE_NAMES[source] ?? `source ${source}`;
  // A bare label, from a descriptor that names no provider: "attested mark" is all it supports.
  return (
    { pyth: "Pyth", reserved: "retired mark", prestocks: "attested mark", mark: "attested mark", mock: "mock walk" }[
      source
    ] ?? source
  );
}

/** The schedule as the chain has it (PDA + account), refreshed each minute. */
export const useOnChainListings = () =>
  useQuery({ queryKey: ["listings"], queryFn: () => fetchListings(rpc), refetchInterval: 60_000 });

/**
 * The collateral schedule on the dashboard: which listing the desk is working, persisted per
 * browser; the session's token signature follows it (one signature per cSTOCK mint).
 */

import { useQuery } from "@tanstack/react-query";
import { fetchListings, PRICE_SOURCE_NAMES, PriceSource } from "@thewindow/solana-sdk";
import { useCallback, useEffect, useMemo, useState } from "react";
import { type ListingView, rpc } from "./chain";
import { useDeployment } from "./queries";
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
 * The listing the desk works: the saved key, else listing #0. Keeps the session's mint in step.
 * The choice is React state (seeded from storage): the descriptor's `listings` array never changes
 * identity, so a memo over it alone would never see a new pick.
 */
export function useSelectedListing() {
  const dep = useDeployment();
  const session = useSession();
  const listings = dep.data?.listings ?? [];
  const [key, setKey] = useState<string | null>(readSelected);
  const selected = useMemo(() => listings.find((l) => l.key === key) ?? listings[0], [listings, key]);
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

/** Human label for a listing's source tag or descriptor string. */
export function sourceLabel(source: string | number | Pick<ListingView, "source" | "priceSource">): string {
  if (typeof source === "object") {
    return source.priceSource === PriceSource.PythAccount ? "Pyth · on-chain" : sourceLabel(source.source);
  }
  if (typeof source === "number") return PRICE_SOURCE_NAMES[source] ?? `source ${source}`;
  return { pyth: "Pyth", tessera: "Tessera mark", prestocks: "PreStocks mark", mock: "mock walk" }[source] ?? source;
}

/** The schedule as the chain has it (PDA + account), refreshed each minute. */
export const useOnChainListings = () =>
  useQuery({ queryKey: ["listings"], queryFn: () => fetchListings(rpc), refetchInterval: 60_000 });

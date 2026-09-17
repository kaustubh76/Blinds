/**
 * The collateral schedule on the dashboard: which listing the desk is working, persisted per
 * browser; the session's token signature follows it (one signature per cSTOCK mint).
 */

import { useQuery } from "@tanstack/react-query";
import { fetchListings, PRICE_SOURCE_NAMES } from "@thewindow/solana-sdk";
import { useCallback, useEffect, useMemo } from "react";
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

/** The listing the desk works: the saved key, else listing #0. Keeps the session's mint in step. */
export function useSelectedListing() {
  const dep = useDeployment();
  const session = useSession();
  const listings = dep.data?.listings ?? [];
  const selected = useMemo(() => {
    const saved = readSelected();
    return listings.find((l) => l.key === saved) ?? listings[0];
  }, [listings]);
  useEffect(() => {
    const mint = selected?.cstockMint ?? null;
    if (session.listing !== mint) session.setListing(mint);
  }, [selected, session]);
  const select = useCallback(
    (key: string) => {
      try {
        localStorage.setItem(LISTING_KEY, key);
      } catch {
        // per-browser convenience only
      }
      const l = listings.find((x) => x.key === key);
      session.setListing(l?.cstockMint ?? null);
    },
    [listings, session],
  );
  return { listings, selected, select };
}

/** The listing a loan is bound to (`Loan.listing`), if the descriptor knows it. */
export function listingByPda(listings: ListingView[], pda: string): ListingView | undefined {
  return listings.find((l) => l.listing === pda);
}

/** Human label for a listing's source tag or descriptor string. */
export function sourceLabel(source: string | number): string {
  if (typeof source === "number") return PRICE_SOURCE_NAMES[source] ?? `source ${source}`;
  return { pyth: "Pyth", tessera: "Tessera mark", prestocks: "PreStocks mark", mock: "mock walk" }[source] ?? source;
}

/** The schedule as the chain has it (PDA + account), refreshed each minute. */
export const useOnChainListings = () =>
  useQuery({ queryKey: ["listings"], queryFn: () => fetchListings(rpc), refetchInterval: 60_000 });

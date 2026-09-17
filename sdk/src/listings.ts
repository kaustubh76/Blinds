/**
 * The collateral schedule: one `Listing` per eligible collateral, each with its own price source,
 * haircut and freshness limits (`docs/TRACKS.md`). Helpers over the generated `Listing` account.
 */
import type { Address } from "@solana/kit";
import type { Listing, PriceCache } from "./generated/window_credit/index.js";

/** `Listing.price_source` tags. */
export const PriceSource = { Pyth: 0, Tessera: 1, PreStocks: 2, Mock: 3 } as const;
export type PriceSourceTag = (typeof PriceSource)[keyof typeof PriceSource];

export const PRICE_SOURCE_NAMES: Record<number, string> = {
  [PriceSource.Pyth]: "Pyth",
  [PriceSource.Tessera]: "Tessera mark",
  [PriceSource.PreStocks]: "PreStocks mark",
  [PriceSource.Mock]: "mock walk",
};

/** Whether the quote's `publish_time` is the publisher's own (Pyth) or the keeper's fetch time (an attested mark). */
export const isAttestedMark = (tag: number): boolean => tag === PriceSource.Tessera || tag === PriceSource.PreStocks;

/**
 * The 32-byte id a non-Pyth listing's `PriceCache` is seeded on: `sha256("<source>:<symbol>")`,
 * e.g. `tessera:T-OpenAI`. A label, never a Pyth feed id — mirrors `ListingCfg::feed_id` in
 * `crates/window-config`.
 */
export async function feedIdForLabel(label: string): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(label));
  return new Uint8Array(digest);
}

export interface QuoteFreshness {
  /** Slots since the keeper posted. */
  postedAgeSlots: number;
  /** Seconds since the quote's own `publish_time`. */
  quoteAgeSecs: number;
  /** `postedAgeSlots ≤ listing.max_price_age` — the keeper is alive. */
  postedFresh: boolean;
  /** `quoteAgeSecs ≤ listing.max_publish_age_secs` — the quote itself is fresh. */
  quoteFresh: boolean;
  /** Both, i.e. `lock_collateral` / `seize` would accept this price right now. */
  usable: boolean;
}

/** The two on-chain freshness rules, evaluated off chain for display. */
export function quoteFreshness(args: {
  listing: Pick<Listing, "maxPriceAge" | "maxPublishAgeSecs">;
  price: Pick<PriceCache, "postedSlot" | "publishTime">;
  slot: number | bigint;
  nowSecs: number | bigint;
}): QuoteFreshness {
  const postedAgeSlots = Math.max(0, Number(BigInt(args.slot) - args.price.postedSlot));
  const quoteAgeSecs = Math.max(0, Number(BigInt(args.nowSecs) - args.price.publishTime));
  const postedFresh = BigInt(postedAgeSlots) <= args.listing.maxPriceAge;
  const quoteFresh = BigInt(quoteAgeSecs) <= args.listing.maxPublishAgeSecs;
  return { postedAgeSlots, quoteAgeSecs, postedFresh, quoteFresh, usable: postedFresh && quoteFresh };
}

/** A listing as the app addresses it: its PDA plus the decoded account. */
export interface ListingRow {
  address: Address;
  data: Listing;
}

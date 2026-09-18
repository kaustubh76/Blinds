/** Read-only lens over the programs (spec v2 §9.7). */
import {
  type Address,
  getAddressEncoder,
  getBase58Decoder,
  getBase64Encoder,
  type ReadonlyUint8Array,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  BID_DISCRIMINATOR,
  type Bid,
  type Epoch,
  fetchMaybeConfig as fetchMaybeAuctionConfig,
  fetchMaybeBid,
  fetchMaybeEpoch,
  getBidDecoder,
} from "./generated/window_auction/index.js";
import {
  fetchMaybeWindowCreditStateConfig as fetchMaybeCreditConfig,
  fetchMaybeListing,
  fetchMaybeLoan,
  fetchMaybePriceCache,
  getListingDecoder,
  getLoanDecoder,
  getPriceCacheDecoder,
  LISTING_DISCRIMINATOR,
  type Listing,
  LOAN_DISCRIMINATOR,
  type Loan,
  type PriceCache,
} from "./generated/window_credit/index.js";
import {
  fetchMaybeOracleState,
  fetchMaybePrint,
  getPrintDecoder,
  type OracleState,
  type Print,
} from "./generated/window_oracle/index.js";
import { fetchMaybeMember } from "./generated/window_registry/index.js";
import { type Quote, readsPythAccount } from "./listings.js";
import * as pda from "./pda.js";
import { PROGRAMS } from "./programs.js";
import { decodePriceUpdate, PYTH_RECEIVER } from "./pyth.js";
import { type Clearing, clear, type DepthCurve, emptyCurve } from "./rates.js";

export type RpcClient = Rpc<SolanaRpcApi>;

export const EpochStatus = { Open: 1, Closed: 2, Printed: 3, NoTrade: 4 } as const;
export const PrintStatus = { Attesting: 1, Missed: 2, Printed: 3, NoTrade: 4 } as const;
export const LoanStatus = {
  Pending: 1,
  Requested: 2,
  Deposited: 3,
  Locked: 4,
  Active: 5,
  Repaid: 6,
  Defaulted: 7,
} as const;
export const LOAN_STATUS_NAMES = [
  "",
  "Pending",
  "Requested",
  "Deposited",
  "Locked",
  "Active",
  "Repaid",
  "Defaulted",
] as const;

export async function fetchAuctionConfig(rpc: RpcClient) {
  const a = await fetchMaybeAuctionConfig(rpc, await pda.auctionConfig());
  return a.exists ? a.data : null;
}
export async function fetchCreditConfig(rpc: RpcClient) {
  const a = await fetchMaybeCreditConfig(rpc, await pda.creditConfig());
  return a.exists ? a.data : null;
}
export async function fetchOracle(rpc: RpcClient): Promise<OracleState | null> {
  const a = await fetchMaybeOracleState(rpc, await pda.oracleState());
  return a.exists ? a.data : null;
}
export async function fetchEpoch(rpc: RpcClient, index: bigint): Promise<Epoch | null> {
  const a = await fetchMaybeEpoch(rpc, await pda.epoch(index));
  return a.exists ? a.data : null;
}
export async function fetchPrint(rpc: RpcClient, index: bigint): Promise<Print | null> {
  const a = await fetchMaybePrint(rpc, await pda.print(index));
  return a.exists ? a.data : null;
}
export async function fetchLoan(rpc: RpcClient, address: Address): Promise<Loan | null> {
  const a = await fetchMaybeLoan(rpc, address);
  return a.exists ? a.data : null;
}
export async function fetchBid(
  rpc: RpcClient,
  epoch: bigint,
  owner: Address,
  side: 0 | 1,
  tick: number,
): Promise<Bid | null> {
  const a = await fetchMaybeBid(rpc, await pda.bid(epoch, owner, side, tick));
  return a.exists ? a.data : null;
}
export async function fetchMember(rpc: RpcClient, owner: Address) {
  const a = await fetchMaybeMember(rpc, await pda.member(owner));
  return a.exists ? a.data : null;
}
export async function fetchPrice(rpc: RpcClient, feedId: Uint8Array) {
  const a = await fetchMaybePriceCache(rpc, await pda.priceCache(feedId));
  return a.exists ? a.data : null;
}

/** Every listing's `PriceCache` in one RPC call; `null` where the account does not exist yet. */
export async function fetchPrices(rpc: RpcClient, feedIds: Uint8Array[]): Promise<Array<PriceCache | null>> {
  if (feedIds.length === 0) return [];
  const addrs = await Promise.all(feedIds.map((f) => pda.priceCache(f)));
  const res = await rpc.getMultipleAccounts(addrs, { encoding: "base64", commitment: "confirmed" }).send();
  const decoder = getPriceCacheDecoder();
  return res.value.map((a) => (a ? decoder.decode(new Uint8Array(b64.encode(a.data[0]))) : null));
}

/** What `fetchQuotes` needs to know about a listing to find and decode its quote. */
export interface QuoteSource {
  feedId: Uint8Array;
  priceSource: number;
  /** Source 4: the Pyth receiver-owned account the listing reads. */
  priceAccount?: Address | null | undefined;
}

/** The account a listing prices from: the cache PDA, or its Pyth account for source 4. */
export async function quoteAccount(l: QuoteSource): Promise<Address> {
  if (readsPythAccount(l.priceSource)) {
    if (!l.priceAccount) throw new Error("a Pyth-account listing names no price account");
    return l.priceAccount;
  }
  return pda.priceCache(l.feedId);
}

/**
 * Every listing's quote in one RPC call, read the way the program reads it; `null` where the
 * account does not exist yet or is not what the listing's source demands (wrong owner, another
 * feed, a partial verification) — exactly the cases the chain would refuse.
 */
export async function fetchQuotes(rpc: RpcClient, listings: QuoteSource[]): Promise<Array<Quote | null>> {
  if (listings.length === 0) return [];
  const addrs = await Promise.all(listings.map(quoteAccount));
  const res = await rpc.getMultipleAccounts(addrs, { encoding: "base64", commitment: "confirmed" }).send();
  const decoder = getPriceCacheDecoder();
  return res.value.map((a, i) => {
    const l = listings[i];
    if (!a || !l) return null;
    const bytes = new Uint8Array(b64.encode(a.data[0]));
    try {
      if (readsPythAccount(l.priceSource)) {
        if (a.owner !== PYTH_RECEIVER) return null;
        const p = decodePriceUpdate(bytes, l.feedId);
        if (p.verification !== "full") return null;
        return {
          price: p.price,
          expo: p.expo,
          publishTime: BigInt(p.publishTime),
          postedSlot: p.postedSlot,
          from: "pyth",
        };
      }
      if (a.owner !== PROGRAMS.credit) return null;
      const c = decoder.decode(bytes);
      return { price: c.price, expo: c.expo, publishTime: c.publishTime, postedSlot: c.postedSlot, from: "cache" };
    } catch {
      return null;
    }
  });
}

/** One listing's quote (see `fetchQuotes`). */
export async function fetchQuote(rpc: RpcClient, l: QuoteSource): Promise<Quote | null> {
  return (await fetchQuotes(rpc, [l]))[0] ?? null;
}

/** One listing of the collateral schedule, by its cSTOCK mint. */
export async function fetchListing(rpc: RpcClient, cstockMint: Address): Promise<Listing | null> {
  const a = await fetchMaybeListing(rpc, await pda.listing(cstockMint));
  return a.exists ? a.data : null;
}

/** The whole collateral schedule, in a stable order (by symbol). */
export async function fetchListings(rpc: RpcClient): Promise<Array<{ address: Address; data: Listing }>> {
  const decoder = getListingDecoder();
  const rows = await programAccounts(rpc, PROGRAMS.credit, LISTING_DISCRIMINATOR, (b) => decoder.decode(b), []);
  return rows.sort((a, b) => symbolOf(a.data).localeCompare(symbolOf(b.data)));
}

/** The listing's zero-padded UTF-8 label as a string. */
export function symbolOf(listing: { symbol: ReadonlyUint8Array | Uint8Array }): string {
  const bytes = Array.from(listing.symbol);
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(new Uint8Array(end < 0 ? bytes : bytes.slice(0, end)));
}

const b58 = getBase58Decoder();
const b64 = getBase64Encoder();

async function programAccounts<T>(
  rpc: RpcClient,
  program: Address,
  discriminator: Uint8Array | ArrayLike<number>,
  decode: (bytes: Uint8Array) => T,
  filters: Array<{ offset: number; bytes: Uint8Array }>,
): Promise<Array<{ address: Address; data: T }>> {
  const memcmp = [{ offset: 0, bytes: new Uint8Array(discriminator) }, ...filters].map((f) => ({
    memcmp: { offset: BigInt(f.offset), bytes: b58.decode(f.bytes) as never, encoding: "base58" as const },
  }));
  const res = await rpc.getProgramAccounts(program, { encoding: "base64", filters: memcmp }).send();
  const out: Array<{ address: Address; data: T }> = [];
  for (const a of res) {
    // An account of an older layout (a pre-listing Loan awaiting migration) must not take the
    // whole list down with it.
    try {
      out.push({ address: a.pubkey, data: decode(new Uint8Array(b64.encode(a.account.data[0]))) });
    } catch {
      // skip
    }
  }
  return out;
}

const addrBytes = (a: Address) => new Uint8Array(getAddressEncoder().encode(a));

/** Loans where `wallet` is the borrower (offset 8+32) or the lender (offset 8). */
export async function fetchLoansFor(
  rpc: RpcClient,
  wallet: Address,
): Promise<{ borrowed: Array<{ address: Address; data: Loan }>; lent: Array<{ address: Address; data: Loan }> }> {
  const decoder = getLoanDecoder();
  const decode = (b: Uint8Array) => decoder.decode(b);
  const [borrowed, lent] = await Promise.all([
    programAccounts(rpc, PROGRAMS.credit, LOAN_DISCRIMINATOR, decode, [{ offset: 8 + 32, bytes: addrBytes(wallet) }]),
    programAccounts(rpc, PROGRAMS.credit, LOAN_DISCRIMINATOR, decode, [{ offset: 8, bytes: addrBytes(wallet) }]),
  ]);
  return { borrowed, lent };
}

/** Every bid PDA of `wallet` (member at offset 8+8). */
export async function fetchBidsFor(rpc: RpcClient, wallet: Address): Promise<Array<{ address: Address; data: Bid }>> {
  const decoder = getBidDecoder();
  return programAccounts(rpc, PROGRAMS.auction, BID_DISCRIMINATOR, (b) => decoder.decode(b), [
    { offset: 8 + 8, bytes: addrBytes(wallet) },
  ]);
}

/** The proven depth curve of a print and its recomputed clearing. */
export function depthFromPrint(p: Print): { curve: DepthCurve; clearing: Clearing | null } {
  const curve = emptyCurve();
  for (let t = 0; t < 37; t++) {
    curve.ask[t] = BigInt(p.claimedSum[0]?.[t] ?? 0n);
    curve.bid[t] = BigInt(p.claimedSum[1]?.[t] ?? 0n);
  }
  return { curve, clearing: clear(curve) };
}

/**
 * The xONIA series: every finalized print up to `latest`, in one `getMultipleAccounts` call rather
 * than one request per epoch — a public RPC rate-limits the latter within a minute of polling.
 */
export async function fetchSeries(
  rpc: RpcClient,
  latest: bigint,
  limit = 50,
): Promise<Array<{ epoch: bigint; print: Print }>> {
  const first = latest - BigInt(limit) + 1n < 0n ? 0n : latest - BigInt(limit) + 1n;
  const indices: bigint[] = [];
  for (let i = first; i <= latest; i++) indices.push(i);
  const addrs = await Promise.all(indices.map((i) => pda.print(i)));
  const decoder = getPrintDecoder();
  const out: Array<{ epoch: bigint; print: Print }> = [];
  // getMultipleAccounts is capped at 100 keys per call
  for (let o = 0; o < addrs.length; o += 100) {
    const res = await rpc.getMultipleAccounts(addrs.slice(o, o + 100), { encoding: "base64" }).send();
    for (const [j, acc] of res.value.entries()) {
      if (!acc) continue;
      const p = decoder.decode(new Uint8Array(b64.encode(acc.data[0])));
      if (p.status === PrintStatus.Printed || p.status === PrintStatus.NoTrade)
        out.push({ epoch: indices[o + j] as bigint, print: p });
    }
  }
  return out;
}

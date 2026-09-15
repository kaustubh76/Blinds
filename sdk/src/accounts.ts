/** Read-only lens over the programs (spec v2 §9.7). */
import {
  type Address,
  getAddressEncoder,
  getBase58Decoder,
  getBase64Encoder,
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
  fetchMaybeLoan,
  fetchMaybePriceCache,
  getLoanDecoder,
  LOAN_DISCRIMINATOR,
  type Loan,
} from "./generated/window_credit/index.js";
import {
  fetchMaybeOracleState,
  fetchMaybePrint,
  type OracleState,
  type Print,
} from "./generated/window_oracle/index.js";
import { fetchMaybeMember } from "./generated/window_registry/index.js";
import * as pda from "./pda.js";
import { PROGRAMS } from "./programs.js";
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
  return res.map((a) => ({ address: a.pubkey, data: decode(new Uint8Array(b64.encode(a.account.data[0]))) }));
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

/** The xONIA series: every finalized print up to `latest`. */
export async function fetchSeries(
  rpc: RpcClient,
  latest: bigint,
  limit = 50,
): Promise<Array<{ epoch: bigint; print: Print }>> {
  const out: Array<{ epoch: bigint; print: Print }> = [];
  for (let i = latest; i >= 0n && out.length < limit; i--) {
    const p = await fetchPrint(rpc, i);
    if (p && (p.status === PrintStatus.Printed || p.status === PrintStatus.NoTrade)) out.push({ epoch: i, print: p });
  }
  return out.reverse();
}

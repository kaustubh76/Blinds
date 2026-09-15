/** Read-only lens over the programs (spec v2 §9.7). */
import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import {
  type Bid,
  type Epoch,
  fetchMaybeConfig as fetchMaybeAuctionConfig,
  fetchMaybeBid,
  fetchMaybeEpoch,
} from "./generated/window_auction/index.js";
import {
  fetchMaybeWindowCreditStateConfig as fetchMaybeCreditConfig,
  fetchMaybeLoan,
  fetchMaybePriceCache,
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

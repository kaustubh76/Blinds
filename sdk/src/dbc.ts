/**
 * Meteora Dynamic Bonding Curve accounts, read the way the dashboard reads everything else: raw
 * bytes over `@solana/kit`, no web3.js v1. Offsets come from the DBC IDL (bytemuck, repr(C)); a test
 * pins them against a captured devnet pool decoded by Meteora's own SDK. The lender agent's token
 * (`services/launch`) trades on such a pool, quoted in a tokenized stock.
 */
import { type Address, address, getAddressDecoder, getBase64Encoder } from "@solana/kit";
import type { RpcClient } from "./accounts.js";

export const DBC_PROGRAM = address("dbcij3LWUppWqq96dh6gJWwBifmcGfLSB5D4DuSMaqN");
const POOL_DISCRIMINATOR = [213, 224, 5, 209, 98, 69, 119, 92];
const CONFIG_DISCRIMINATOR = [26, 108, 14, 123, 116, 230, 129, 43];

export interface DbcPool {
  config: Address;
  creator: Address;
  baseMint: Address;
  baseReserve: bigint;
  quoteReserve: bigint;
  partnerQuoteFee: bigint;
  creatorQuoteFee: bigint;
  totalTradingQuoteFee: bigint;
  sqrtPrice: bigint;
  isMigrated: boolean;
  migrationProgress: number;
}
export interface DbcConfig {
  quoteMint: Address;
  migrationQuoteThreshold: bigint;
  sqrtStartPrice: bigint;
  migrationSqrtPrice: bigint;
}

const u64 = (v: DataView, o: number) => v.getBigUint64(o, true);
const u128 = (v: DataView, o: number) => v.getBigUint64(o, true) | (v.getBigUint64(o + 8, true) << 64n);
const addr = (b: Uint8Array, o: number) => getAddressDecoder().decode(b.subarray(o, o + 32));
const check = (b: Uint8Array, disc: number[], what: string) => {
  if (!disc.every((x, i) => b[i] === x)) throw new Error(`not a DBC ${what} account`);
};

export function decodeDbcPool(b: Uint8Array): DbcPool {
  check(b, POOL_DISCRIMINATOR, "pool");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {
    config: addr(b, 72),
    creator: addr(b, 104),
    baseMint: addr(b, 136),
    baseReserve: u64(v, 232),
    quoteReserve: u64(v, 240),
    partnerQuoteFee: u64(v, 272),
    sqrtPrice: u128(v, 280),
    isMigrated: b[305] !== 0,
    migrationProgress: b[308] ?? 0,
    totalTradingQuoteFee: u64(v, 336),
    creatorQuoteFee: u64(v, 360),
  };
}

export function decodeDbcConfig(b: Uint8Array): DbcConfig {
  check(b, CONFIG_DISCRIMINATOR, "config");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {
    quoteMint: addr(b, 8),
    migrationQuoteThreshold: u64(v, 264),
    migrationSqrtPrice: u128(v, 280),
    sqrtStartPrice: u128(v, 392),
  };
}

/** Price of one base token in quote tokens, from the pool's Q64.64 sqrt price and the two decimals. */
export function dbcPrice(sqrtPrice: bigint, baseDecimals: number, quoteDecimals: number): number {
  const s = Number(sqrtPrice) / 2 ** 64;
  return s * s * 10 ** (baseDecimals - quoteDecimals);
}

/** The pool and its config in one RPC call; `null` where an account is missing. */
export async function fetchDbc(
  rpc: RpcClient,
  pool: Address,
): Promise<{ pool: DbcPool; config: DbcConfig; progress: number } | null> {
  const b64 = getBase64Encoder();
  const p = await rpc.getAccountInfo(pool, { encoding: "base64", commitment: "confirmed" }).send();
  if (!p.value || p.value.owner !== DBC_PROGRAM) return null;
  const poolData = decodeDbcPool(new Uint8Array(b64.encode(p.value.data[0])));
  const c = await rpc.getAccountInfo(poolData.config, { encoding: "base64", commitment: "confirmed" }).send();
  if (!c.value) return null;
  const config = decodeDbcConfig(new Uint8Array(b64.encode(c.value.data[0])));
  const progress =
    config.migrationQuoteThreshold > 0n
      ? Math.min(1, Number(poolData.quoteReserve) / Number(config.migrationQuoteThreshold))
      : 0;
  return { pool: poolData, config, progress };
}

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
  /** Unix seconds (activation type Timestamp): when the curve opened and the fee schedule started. */
  activationPoint: bigint;
  isMigrated: boolean;
  migrationProgress: number;
  /** Set once the threshold was reached (unix seconds), else 0. */
  finishCurveTimestamp: bigint;
  hasSwap: boolean;
}
export interface DbcBaseFee {
  /** Fee at period 0, in basis points (the program stores a numerator over 1e9). */
  cliffBps: number;
  /** 0 = linear (cliff − k·reduction bps), 1 = exponential (cliff · (1 − reduction/10000)^k). */
  mode: number;
  numberOfPeriod: number;
  /** Seconds per period under Timestamp activation (slots under Slot activation). */
  periodFrequency: number;
  /** Per-period reduction: bps of fee (linear) or bps of the remaining fee (exponential). */
  reductionFactor: number;
}
export interface DbcConfig {
  quoteMint: Address;
  /** Who claims the partner's share of trading fees and receives the migration fee. */
  feeClaimer: Address;
  baseFee: DbcBaseFee;
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
    activationPoint: u64(v, 296),
    isMigrated: b[305] !== 0,
    migrationProgress: b[308] ?? 0,
    totalTradingQuoteFee: u64(v, 336),
    finishCurveTimestamp: u64(v, 344),
    creatorQuoteFee: u64(v, 360),
    hasSwap: b[370] !== 0,
  };
}

export function decodeDbcConfig(b: Uint8Array): DbcConfig {
  check(b, CONFIG_DISCRIMINATOR, "config");
  const v = new DataView(b.buffer, b.byteOffset, b.byteLength);
  return {
    quoteMint: addr(b, 8),
    feeClaimer: addr(b, 40),
    baseFee: {
      cliffBps: Number(u64(v, 104)) / 1e5, // numerator over 1e9 → bps
      periodFrequency: Number(u64(v, 112)),
      reductionFactor: Number(u64(v, 120)),
      numberOfPeriod: v.getUint16(128, true),
      mode: b[130] ?? 0,
    },
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

export interface DbcFeeNow {
  /** The base trading fee in force now, in basis points (before any dynamic-fee add-on). */
  bps: number;
  /** Periods elapsed, capped at the schedule's length. */
  period: number;
  periodsLeft: number;
  /** Seconds until the next step down; 0 once the schedule has run out. */
  secsToNext: number;
  /** Where the schedule ends, in bps. */
  restingBps: number;
}

/** The fee schedule evaluated at `nowSecs`, the way the program does (`get_current_base_fee_numerator`). */
export function dbcFeeAt(fee: DbcBaseFee, activationPoint: bigint | number, nowSecs: number): DbcFeeNow {
  const start = Number(activationPoint);
  const n = fee.numberOfPeriod;
  const step = (k: number) =>
    fee.mode === 1 ? fee.cliffBps * (1 - fee.reductionFactor / 10_000) ** k : fee.cliffBps - k * fee.reductionFactor;
  const restingBps = Math.max(0, step(n));
  if (n === 0 || fee.periodFrequency <= 0)
    return { bps: fee.cliffBps, period: 0, periodsLeft: 0, secsToNext: 0, restingBps };
  const elapsed = Math.max(0, nowSecs - start);
  const raw = Math.floor(elapsed / fee.periodFrequency);
  const period = Math.min(n, raw);
  const periodsLeft = n - period;
  const secsToNext = periodsLeft === 0 ? 0 : Math.max(0, (raw + 1) * fee.periodFrequency - elapsed);
  return { bps: Math.max(0, step(period)), period, periodsLeft, secsToNext, restingBps };
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

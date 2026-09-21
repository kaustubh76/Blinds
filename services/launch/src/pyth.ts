/**
 * Pyth's `Crypto.TSLAX/USD` from its own push-oracle accounts on mainnet — the same read the desk's
 * keeper and dashboard make (`services/admin/src/price.rs`, `app/src/lib/pyth.ts`), here on web3.js v1
 * because the DBC SDK lives there. Keyless; the freshest of the known shards wins.
 */
import { type Connection, PublicKey } from "@solana/web3.js";

export const PYTH_RECEIVER = new PublicKey("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
export const PYTH_PUSH_ORACLE = new PublicKey("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");
export const TSLAX_USD_FEED = "47a156470288850a440df3a6ce85a55917b813a19bb5b31128a33a986566a362";
/** The underlying equity: what the wrapper tracks within basis points, and the desk's own comparison feed. */
export const TSLA_USD_FEED = "16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1";
/** Older than this and a quote is a broken feed, not a price (the wrapper's only push account died 12 Sep). */
export const QUOTE_MAX_AGE_SECS = 24 * 3600;

export type QuoteFeed = "Crypto.TSLAX/USD" | "Equity.US.TSLA/USD";

export interface PythQuote {
  price: bigint;
  expo: number;
  publishTime: number;
  account: string;
  usd: number;
  ageSecs: number;
}

/** Which of the two reads prices the quote: the wrapper while fresh, else the fresher of the two. */
export function pickQuote<Q extends { publishTime: number; ageSecs: number }>(
  wrapper: Q | null,
  equity: Q | null,
): (Q & { feed: QuoteFeed }) | null {
  if (wrapper && wrapper.ageSecs <= QUOTE_MAX_AGE_SECS) return { ...wrapper, feed: "Crypto.TSLAX/USD" };
  if (equity && (!wrapper || equity.publishTime > wrapper.publishTime))
    return { ...equity, feed: "Equity.US.TSLA/USD" };
  return wrapper ? { ...wrapper, feed: "Crypto.TSLAX/USD" } : null;
}

/**
 * The USD price of the quote token, the way the desk would price it: the wrapper feed when it is
 * fresh, else the underlying equity feed (recorded as such). Null when neither is readable.
 */
export async function fetchQuoteUsd(conn: Connection): Promise<(PythQuote & { feed: QuoteFeed }) | null> {
  const [wrapper, equity] = await Promise.all([
    fetchFreshest(conn, TSLAX_USD_FEED),
    fetchFreshest(conn, TSLA_USD_FEED),
  ]);
  return pickQuote(wrapper, equity);
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

export function decodePriceUpdate(data: Uint8Array, expectedFeedHex: string) {
  let off = 8 + 32;
  const tag = data[off];
  if (tag === 0) off += 2;
  else if (tag === 1) off += 1;
  else throw new Error(`unknown Pyth verification level ${tag}`);
  const end = off + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8 + 8;
  if (data.length < end) throw new Error(`price account too short: ${data.length} bytes`);
  const feedId = hex(data.subarray(off, off + 32));
  if (feedId !== expectedFeedHex) throw new Error(`price account carries feed ${feedId}`);
  off += 32;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const price = view.getBigInt64(off, true);
  off += 16;
  const expo = view.getInt32(off, true);
  off += 4;
  const publishTime = Number(view.getBigInt64(off, true));
  if (price <= 0n) throw new Error(`Pyth published a non-positive price (${price})`);
  return { price, expo, publishTime, verification: tag === 1 ? "full" : "partial" };
}

export function pushOraclePda(shard: number, feedHex: string): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from([shard & 0xff, (shard >> 8) & 0xff]), Buffer.from(feedHex, "hex")],
    PYTH_PUSH_ORACLE,
  )[0];
}

/** The freshest usable quote among the feed's push accounts (shards 0 and 1), or null. */
export async function fetchFreshest(
  conn: Connection,
  feedHex = TSLAX_USD_FEED,
  shards = [0, 1],
): Promise<PythQuote | null> {
  const keys = shards.map((s) => pushOraclePda(s, feedHex));
  const infos = await conn.getMultipleAccountsInfo(keys);
  let best: PythQuote | null = null;
  const now = Math.floor(Date.now() / 1000);
  infos.forEach((info, i) => {
    const key = keys[i];
    if (!info || !key || !info.owner.equals(PYTH_RECEIVER)) return;
    try {
      const q = decodePriceUpdate(new Uint8Array(info.data), feedHex);
      if (q.verification !== "full") return;
      const usd = Number(q.price) * 10 ** q.expo;
      const cand: PythQuote = { ...q, account: key.toBase58(), usd, ageSecs: Math.max(0, now - q.publishTime) };
      if (!best || cand.publishTime > best.publishTime) best = cand;
    } catch {
      // another feed or a malformed account: not ours to use
    }
  });
  return best;
}

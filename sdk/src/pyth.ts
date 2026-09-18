/**
 * Pyth's `PriceUpdateV2` account, decoded the way `window_credit::quote` decodes it on chain for a
 * `price_source = 4` listing: `disc(8) ‖ write_authority(32) ‖ verification_level ‖ feed_id(32) ‖
 * price i64 ‖ conf u64 ‖ expo i32 ‖ publish_time i64 ‖ prev_publish_time i64 ‖ ema_price i64 ‖
 * ema_conf u64 ‖ posted_slot u64`. `verification_level` is a Borsh enum: `Partial{n: u8}` = 2 bytes,
 * `Full` = 1. Mirrors `decode_price_update` in services/admin/src/price.rs.
 */
import { type Address, address, getProgramDerivedAddress } from "@solana/kit";

/** Owner of every Pyth price-update account. */
export const PYTH_RECEIVER = address("rec5EKMGg6MxZYaMdyBfgwp4d5rB9T1VQH5pJv5LtFJ");
/** Pyth's push oracle; its PDAs `[shard u16 LE, feed_id]` are the canonical price-update accounts. */
export const PYTH_PUSH_ORACLE = address("pythWSnswVUd12oZpeFP8e9CVaEqJg25g1Vtc2biRsT");

export interface PythPrice {
  price: bigint;
  expo: number;
  publishTime: number;
  /** The slot Pyth's receiver wrote the account — what the program's slot rule reads for source 4. */
  postedSlot: bigint;
  /** `Full` = every guardian signature verified; `Partial(n)` = n of them. */
  verification: "full" | `partial(${number})`;
}

export const hexToBytes = (hex: string): Uint8Array => {
  const h = hex.replace(/^0x/, "");
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
};
export const bytesToHex = (b: Uint8Array): string => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

const feedHex = (feed: string | Uint8Array): string =>
  typeof feed === "string" ? feed.replace(/^0x/, "").toLowerCase() : bytesToHex(feed);

/** Decodes a `PriceUpdateV2`; throws when it is not one, carries another feed, or a non-positive price. */
export function decodePriceUpdate(data: Uint8Array, expectedFeedId: string | Uint8Array): PythPrice {
  let off = 8 + 32;
  if (data.length < off + 1) throw new Error("price account too short");
  const tag = data[off];
  let verification: PythPrice["verification"];
  if (tag === 0) {
    verification = `partial(${data[off + 1] ?? 0})`;
    off += 2;
  } else if (tag === 1) {
    verification = "full";
    off += 1;
  } else {
    throw new Error(`unknown Pyth verification level ${tag}`);
  }
  const end = off + 32 + 8 + 8 + 4 + 8 + 8 + 8 + 8 + 8;
  if (data.length < end) throw new Error(`price account too short: ${data.length} bytes`);
  const feedId = bytesToHex(data.subarray(off, off + 32));
  const expected = feedHex(expectedFeedId);
  if (feedId !== expected) throw new Error(`price account carries feed ${feedId}, expected ${expected}`);
  off += 32;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const price = view.getBigInt64(off, true);
  off += 8 + 8; // price, conf
  const expo = view.getInt32(off, true);
  off += 4;
  const publishTime = Number(view.getBigInt64(off, true));
  const postedSlot = view.getBigUint64(end - 8, true);
  if (price <= 0n) throw new Error(`Pyth published a non-positive price (${price})`);
  return { price, expo, publishTime, postedSlot, verification };
}

/** The push-oracle PDA holding `feedId` on `shard`. */
export async function pushOraclePda(shard: number, feedId: string | Uint8Array): Promise<Address> {
  const [pda] = await getProgramDerivedAddress({
    programAddress: PYTH_PUSH_ORACLE,
    seeds: [new Uint8Array([shard & 0xff, (shard >> 8) & 0xff]), hexToBytes(feedHex(feedId))],
  });
  return pda;
}

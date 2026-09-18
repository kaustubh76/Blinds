/**
 * The collateral schedule as the chain sees it right now: every Listing, its PriceCache, and the two
 * freshness rules `lock_collateral` and `seize` apply — evaluated off chain with the SDK's own
 * `quoteFreshness`. No transaction, no service of ours: only the RPC.
 * Usage: WINDOW_RPC_URL=https://api.devnet.solana.com pnpm schedule
 */
import { createSolanaRpc } from "@solana/kit";
import {
  fetchListings,
  fetchPrice,
  isAttestedMark,
  PRICE_SOURCE_NAMES,
  quoteFreshness,
  symbolOf,
  withRpcRetry,
} from "@thewindow/solana-sdk";

const rpcUrl = process.env.WINDOW_RPC_URL ?? "http://127.0.0.1:8899";
const rpc = createSolanaRpc(rpcUrl);
const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const age = (s: number) => (s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

const [listings, slot, blockTime] = await Promise.all([
  withRpcRetry(() => fetchListings(rpc)),
  withRpcRetry(async () => Number(await rpc.getSlot({ commitment: "confirmed" }).send())),
  withRpcRetry(async () => {
    const s = await rpc.getSlot({ commitment: "confirmed" }).send();
    return Number(await rpc.getBlockTime(s).send());
  }),
]);
console.log(
  `${rpcUrl} · slot ${slot} · chain time ${new Date(blockTime * 1000).toISOString()} · ${listings.length} listing(s)\n`,
);
let usable = 0;
for (const { address, data: l } of listings) {
  const price = await withRpcRetry(() => fetchPrice(rpc, new Uint8Array(l.feedId)));
  const source = PRICE_SOURCE_NAMES[l.priceSource] ?? `source ${l.priceSource}`;
  const head = `${symbolOf(l).padEnd(16)} ${address}  ${source}${isAttestedMark(l.priceSource) ? " (attested mark)" : ""}  haircut ${Number(l.haircutBps) / 100}%`;
  if (!price) {
    console.log(`${head}\n  no PriceCache yet for feed ${hex(l.feedId).slice(0, 8)}… → not usable\n`);
    continue;
  }
  const f = quoteFreshness({ listing: l, price, slot, nowSecs: blockTime });
  const value = (Number(price.price) * 10 ** price.expo).toFixed(2);
  console.log(head);
  console.log(`  mark ${value} USD · ${price.posts} posts · feed ${hex(l.feedId).slice(0, 8)}…`);
  console.log(
    `  posted  ${f.postedAgeSlots} slots ago  (limit ${l.maxPriceAge})            ${f.postedFresh ? "ok" : "STALE  → PriceStale"}`,
  );
  console.log(
    `  quote   ${age(f.quoteAgeSecs)} old  (limit ${age(Number(l.maxPublishAgeSecs))})   ${f.quoteFresh ? "ok" : "STALE  → QuoteStale"}`,
  );
  console.log(`  lock / seize now: ${f.usable ? "ACCEPTED" : "REFUSED"}\n`);
  if (f.usable) usable++;
}
console.log(`${usable}/${listings.length} listing(s) usable for lock and seize right now`);

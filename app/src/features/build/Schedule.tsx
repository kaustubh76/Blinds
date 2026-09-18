/**
 * The collateral schedule for a developer: every listing with the addresses an integration needs
 * (listing PDA, price-cache PDA, feed id), its source, mark and the two freshness verdicts the
 * chain would give right now — and the SDK calls that produced each row.
 */
import { useQuery } from "@tanstack/react-query";
import {
  fetchListings,
  fetchPrices,
  isAttestedMark,
  PRICE_SOURCE_NAMES,
  pda,
  quoteFreshness,
  symbolOf,
  withRpcRetry,
} from "@thewindow/solana-sdk";
import { useState } from "react";
import { CopyButton } from "../../components/DevConsole";
import { Skeleton } from "../../components/Skeleton";
import { Badge, Button, ExplorerLink, type Tone } from "../../components/ui";
import { config } from "../../config";
import { rpc } from "../../lib/chain";
import { useSlot } from "../../lib/queries";

const SOURCE_TONE: Record<string, Tone> = { Pyth: "accent", "Tessera mark": "lend", "PreStocks mark": "borrow" };

const hex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
const age = (s: number) => (s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);

const CODE = `const listings = await sdk.fetchListings(rpc);
const prices   = await sdk.fetchPrices(rpc, listings.map((l) => new Uint8Array(l.data.feedId)));
const slot     = Number(await rpc.getSlot({ commitment: "confirmed" }).send());
const now      = Number(await rpc.getBlockTime(BigInt(slot)).send());
const rows = listings.map(({ address, data: l }, i) => ({
  symbol: sdk.symbolOf(l), source: sdk.PRICE_SOURCE_NAMES[l.priceSource], listing: address,
  priceCache: sdk.pda.priceCache(new Uint8Array(l.feedId)),
  ...(prices[i] ? sdk.quoteFreshness({ listing: l, price: prices[i], slot, nowSecs: now }) : { usable: false }),
}));`;

/** One query for the whole schedule: listings, their caches, the slot's block time. */
function useScheduleRows() {
  const slot = useSlot();
  return useQuery({
    queryKey: ["build-schedule", slot.data],
    queryFn: async () => {
      const listings = await withRpcRetry(() => fetchListings(rpc));
      const prices = await withRpcRetry(() =>
        fetchPrices(
          rpc,
          listings.map((l) => new Uint8Array(l.data.feedId)),
        ),
      );
      const s = Number(await withRpcRetry(() => rpc.getSlot({ commitment: "confirmed" }).send()));
      const now = Number(await withRpcRetry(() => rpc.getBlockTime(BigInt(s)).send()));
      return Promise.all(
        listings.map(async ({ address, data: l }, i) => {
          const price = prices[i] ?? null;
          const fresh = price ? quoteFreshness({ listing: l, price, slot: s, nowSecs: now }) : null;
          return {
            symbol: symbolOf(l),
            source: PRICE_SOURCE_NAMES[l.priceSource] ?? `source ${l.priceSource}`,
            attested: isAttestedMark(l.priceSource),
            listing: address,
            priceCache: await pda.priceCache(new Uint8Array(l.feedId)),
            feedId: hex(l.feedId),
            haircut: `${Number(l.haircutBps) / 100}%`,
            limits: { quoteSecs: Number(l.maxPublishAgeSecs), postedSlots: Number(l.maxPriceAge) },
            mark: price ? Number(price.price) * 10 ** price.expo : null,
            posts: price ? Number(price.posts) : 0,
            fresh,
          };
        }),
      );
    },
    staleTime: 20_000,
  });
}

export function Schedule() {
  const rows = useScheduleRows();
  const [code, setCode] = useState(false);
  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs text-ink-3">
          {rows.data
            ? `${rows.data.length} listings · ${rows.data.filter((r) => r.fresh?.usable).length} usable for lock & seize right now`
            : "reading the schedule…"}
        </span>
        <span className="ml-auto flex gap-1">
          <Button variant="ghost" size="sm" icon="code" onClick={() => setCode((v) => !v)}>
            {code ? "hide code" : "code"}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon="refresh"
            onClick={() => void rows.refetch()}
            loading={rows.isFetching}
          >
            refresh
          </Button>
        </span>
      </div>
      {code && (
        <div className="relative">
          <pre className="mono overflow-x-auto rounded-[var(--radius-md)] border border-line bg-surface-0 p-3 text-[11.5px] leading-relaxed text-ink-1">
            {CODE}
          </pre>
          <div className="absolute top-1.5 right-1.5">
            <CopyButton text={CODE} />
          </div>
        </div>
      )}
      {rows.isLoading && <Skeleton className="h-24 w-full" />}
      {rows.isError && <p className="text-xs text-status-warning">the RPC did not answer — refresh</p>}
      {rows.data && (
        <ul className="grid gap-2">
          {rows.data.map((r) => (
            <li key={r.listing} className="rounded-[var(--radius-md)] border border-line bg-surface-0 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-medium text-ink-1">{r.symbol}</span>
                <Badge tone={SOURCE_TONE[r.source] ?? "mute"}>{r.source}</Badge>
                {r.attested && <Badge tone="warn">attested · publish_time = keeper fetch</Badge>}
                <span className="num text-sm text-ink-1">
                  {r.mark !== null ? `$${r.mark.toLocaleString("en-US", { maximumFractionDigits: 2 })}` : "no cache"}
                </span>
                <span className="text-xs text-ink-3">haircut {r.haircut}</span>
                <span className="ml-auto">
                  {r.fresh ? (
                    <Badge tone={r.fresh.usable ? "good" : "bad"} icon={r.fresh.usable ? "check" : "alert"}>
                      {r.fresh.usable ? "lock & seize accepted" : !r.fresh.quoteFresh ? "QuoteStale" : "PriceStale"}
                    </Badge>
                  ) : (
                    <Badge>no price yet</Badge>
                  )}
                </span>
              </div>
              {r.fresh && (
                <div className="mt-1 text-xs text-ink-3">
                  quote {age(r.fresh.quoteAgeSecs)} old (limit {age(r.limits.quoteSecs)}) · posted{" "}
                  {r.fresh.postedAgeSlots} slots ago (limit {r.limits.postedSlots}) · {r.posts} posts
                </div>
              )}
              <dl className="mono mt-2 grid gap-x-4 gap-y-0.5 text-[11px] sm:grid-cols-[auto_1fr_auto]">
                {(
                  [
                    ["listing", r.listing, true],
                    ["priceCache", r.priceCache, true],
                    ["feedId", r.feedId, false],
                  ] as const
                ).map(([k, v, link]) => (
                  <div key={k} className="contents">
                    <dt className="text-ink-3">{k}</dt>
                    <dd className="min-w-0 truncate text-ink-2">
                      {link ? (
                        <ExplorerLink address={v} cluster={config.cluster}>
                          {v}
                        </ExplorerLink>
                      ) : (
                        v
                      )}
                    </dd>
                    <dd>
                      <CopyButton text={v} />
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

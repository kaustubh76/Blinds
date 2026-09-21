/**
 * The collateral schedule: one row per listed collateral with its source, mark, both on-chain
 * freshness rules (keeper post age in slots, quote age in seconds) and haircut. Attested marks
 * (PreStocks) are labelled as such — their `publish_time` is the keeper's fetch time.
 */
import type { credit as creditNs } from "@thewindow/solana-sdk";
import { isAttestedMark, PriceSource, quoteFreshness, symbolOf } from "@thewindow/solana-sdk";

type PriceCache = Pick<creditNs.PriceCache, "price" | "expo" | "publishTime" | "postedSlot">;

import { Card } from "../../components/Card";
import { ListingCard } from "../../components/ListingCard";
import { Badge, ExplorerLink } from "../../components/ui";
import { config } from "../../config";
import type { ListingView } from "../../lib/chain";
import { formatAge, formatPrice, formatSlotAge } from "../../lib/format";
import { sourceLabel, useOnChainListings } from "../../lib/listings";
import { useDeployment, usePrices, useSlot } from "../../lib/queries";

const SOURCE_URL: Record<string, string> = {
  prestocks: "https://prestocks.com/api/prestocks",
  pyth: "https://www.pyth.network/price-feeds/crypto-tslax-usd",
};

export function CollateralSchedule() {
  const dep = useDeployment();
  const onChain = useOnChainListings();
  const slot = useSlot();
  const listings = dep.data?.listings ?? [];
  const prices = usePrices(dep.data?.listings);
  if (listings.length <= 1 && (onChain.data?.length ?? 0) <= 1) return null;
  return (
    <Card
      eyebrow="collateral schedule"
      title={`${listings.length} eligible collaterals · one rate`}
      footer={
        <>
          Every listing is a <span className="mono">Listing</span> account with its own price cache, haircut and two
          freshness limits, both enforced at <span className="mono">lock_collateral</span> and{" "}
          <span className="mono">seize</span>: the keeper must have posted within{" "}
          <span className="mono">max_price_age</span> slots, and the quote&apos;s own timestamp must be within{" "}
          <span className="mono">max_publish_age</span>. The PreStocks mark is a copy of a public API, timestamped when
          the keeper fetched it — attested, not signed; the Pyth quote carries the publisher&apos;s own timestamp.
          Devnet twins of the tokens; nothing on mainnet is touched.
        </>
      }
    >
      <div className="mb-4 grid gap-3 md:grid-cols-2">
        {listings.map((l, i) => (
          <ListingCard
            key={l.key}
            listing={l}
            price={prices.data ? (prices.data[i] ?? null) : undefined}
            slot={slot.data}
            compact
          />
        ))}
      </div>
      <details className="group">
        <summary className="cursor-pointer list-none text-sm text-accent hover:underline">
          <span className="group-open:hidden">show the rules per listing →</span>
          <span className="hidden group-open:inline">hide the table</span>
        </summary>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
              <tr>
                <th className="py-2 pr-4 font-medium">listing</th>
                <th className="py-2 pr-4 font-medium">source</th>
                <th className="py-2 pr-4 font-medium">mark</th>
                <th className="py-2 pr-4 font-medium">quote age</th>
                <th className="py-2 pr-4 font-medium">posted</th>
                <th className="py-2 pr-4 font-medium">haircut</th>
                <th className="py-2 pr-4 font-medium">usable</th>
              </tr>
            </thead>
            <tbody>
              {listings.map((l, i) => (
                <Row
                  key={l.key}
                  listing={l}
                  slot={slot.data}
                  price={prices.data?.[i] ?? null}
                  state={prices.isError ? "error" : prices.data ? "ready" : "loading"}
                />
              ))}
            </tbody>
          </table>
        </div>
      </details>
      {onChain.data && onChain.data.length !== listings.length && (
        <p className="mt-3 text-xs text-ink-3">
          The chain lists {onChain.data.length} collateral{onChain.data.length === 1 ? "" : "s"}
          {onChain.data.length > listings.length
            ? ` — ${onChain.data
                .filter((c) => !listings.some((l) => l.listing === c.address))
                .map((c) => symbolOf(c.data))
                .join(
                  ", ",
                )}: retired (a listing cannot be closed; it refuses every lock and seize and is not part of this deployment).`
            : "; this descriptor is ahead of the chain (sync pending)."}
        </p>
      )}
    </Card>
  );
}

function Row({
  listing: l,
  slot,
  price: cache,
  state,
}: {
  listing: ListingView;
  slot: number | undefined;
  price: PriceCache | null;
  state: "loading" | "ready" | "error";
}) {
  const price = { data: cache };
  const attested = isAttestedMark(l.priceSource);
  const onChainPyth = l.priceSource === PriceSource.PythAccount;
  const fresh =
    price.data && slot !== undefined
      ? quoteFreshness({
          listing: { maxPriceAge: BigInt(l.maxPriceAgeSlots), maxPublishAgeSecs: BigInt(l.maxPublishAgeSecs) },
          price: price.data,
          slot,
          nowSecs: Math.floor(Date.now() / 1000),
        })
      : null;
  const url = SOURCE_URL[l.source];
  return (
    <tr className="border-t border-line align-top">
      <td className="py-2 pr-4">
        <div className="font-medium text-ink-1">{l.symbol}</div>
        <div className="mono text-[11px] text-ink-3">
          <ExplorerLink address={l.listing} cluster={config.cluster}>
            listing
          </ExplorerLink>{" "}
          · feed {Array.from(l.feedId.slice(0, 4), (b) => b.toString(16).padStart(2, "0")).join("")}…
        </div>
      </td>
      <td className="py-2 pr-4">
        <div className="flex flex-wrap items-center gap-1">
          {url ? (
            <a href={url} target="_blank" rel="noreferrer" className="text-ink-1 underline decoration-line">
              {sourceLabel(l)}
            </a>
          ) : (
            <span>{sourceLabel(l)}</span>
          )}
          {attested && (
            <Badge tone="warn" icon="alert">
              attested
            </Badge>
          )}
        </div>
        <div className="text-[11px] text-ink-3">
          {attested
            ? "publish_time = keeper fetch time"
            : onChainPyth
              ? "the program reads Pyth's receiver-owned account"
              : l.source === "pyth"
                ? "publisher's own timestamp"
                : "local mock"}
        </div>
      </td>
      <td className="py-2 pr-4 text-ink-1">{price.data ? formatPrice(price.data.price, price.data.expo) : "—"}</td>
      <td className="py-2 pr-4">
        {price.data ? (
          <span className={fresh && !fresh.quoteFresh ? "text-status-serious" : ""}>
            {formatAge(price.data.publishTime)}
            <span className="block text-[11px] text-ink-3">limit {formatSlotAge(l.maxPublishAgeSecs / 0.45)}</span>
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="py-2 pr-4">
        {fresh ? (
          <span className={fresh.postedFresh ? "" : "text-status-serious"}>
            {formatSlotAge(fresh.postedAgeSlots)} ago
            <span className="block text-[11px] text-ink-3">limit {formatSlotAge(l.maxPriceAgeSlots)}</span>
          </span>
        ) : (
          "—"
        )}
      </td>
      <td className="py-2 pr-4 text-ink-1">{Number(l.haircutBps) / 100}%</td>
      <td className="py-2 pr-4">
        {fresh ? (
          <Badge tone={fresh.usable ? "good" : "bad"} icon={fresh.usable ? "check" : "alert"}>
            {fresh.usable ? "lock & seize" : fresh.postedFresh ? "quote stale" : "post stale"}
          </Badge>
        ) : (
          <Badge tone="mute">{state === "error" ? "rpc busy" : state === "loading" ? "loading" : "no price yet"}</Badge>
        )}
      </td>
    </tr>
  );
}

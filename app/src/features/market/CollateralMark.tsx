/**
 * The collateral mark: the wrapper quote the desk locks and seizes against, beside the underlying
 * equity feed read straight from Pyth's mainnet account. The quote's own timestamp is what tells
 * you whether the mark is fresh — not how recently the keeper posted it.
 */
import { quoteFreshness } from "@thewindow/solana-sdk";
import { Card } from "../../components/Card";
import { Stat } from "../../components/Stat";
import { Badge, DocLink, ExplorerLink } from "../../components/ui";
import { bytesToHex } from "../../lib/chain";
import { formatAge, formatPrice, formatSlotAge } from "../../lib/format";
import { basisBps, FEEDS, formatBasis, nyseSession, useUnderlying } from "../../lib/pyth";
import { useCreditConfig, useDeployment, useMultiplier, useQuote, useSlot } from "../../lib/queries";
import { secsToSlots } from "../../lib/slotTime";

export function CollateralMark() {
  const dep = useDeployment();
  const credit = useCreditConfig();
  const slot = useSlot();
  const price = useQuote(dep.data?.listings[0]);
  const mult = useMultiplier(dep.data?.mockMint);
  const underlying = useUnderlying(FEEDS["Equity.US.TSLA/USD"]);
  const session = nyseSession();

  const listing = dep.data?.listings[0];
  // The wrapper feed's freshest push-oracle account on mainnet — the account the keeper itself
  // reads, found the same way (`fetchFreshest` over shards 0 and 1) rather than named in advance.
  const wrapper = useUnderlying(listing ? bytesToHex(listing.feedId) : FEEDS["Crypto.TSLAX/USD"]);
  // No listing means no limit to state. This used to fall back to 3,600 and print it in the footer
  // as "here", so a descriptor without a schedule was given a rule it had never carried.
  const staleAfter = listing?.maxPublishAgeSecs ?? null;
  // Both rules the chain applies, not just the quote's own age: a quote can be young and still refused
  // because nobody posted it lately, and this card used to warn only by luck when both were breached.
  const fresh =
    listing && price.data && slot.data !== undefined
      ? quoteFreshness({
          listing: {
            maxPriceAge: BigInt(listing.maxPriceAgeSlots),
            maxPublishAgeSecs: BigInt(listing.maxPublishAgeSecs),
          },
          price: price.data,
          slot: slot.data,
          nowSecs: Math.floor(Date.now() / 1000),
        })
      : null;
  const quoteStale = fresh ? !fresh.quoteFresh : false;
  const basis = price.data && underlying.data ? basisBps(price.data, underlying.data) : null;

  return (
    <Card
      eyebrow="collateral mark · Pyth"
      title={price.data ? formatPrice(price.data.price, price.data.expo) : "—"}
      right={
        <span className="flex flex-wrap items-center gap-2">
          {fresh && !fresh.usable && (
            <Badge tone="warn" icon="alert">
              {quoteStale && staleAfter !== null
                ? `quote older than ${formatSlotAge(secsToSlots(staleAfter))}`
                : "posted too long ago"}{" "}
              · locks refused
            </Badge>
          )}
          {wrapper.data ? (
            <ExplorerLink address={wrapper.data.account} cluster="mainnet-beta">
              Pyth account · {formatAge(wrapper.data.publishTime)}
            </ExplorerLink>
          ) : (
            <Badge tone="mute" {...(wrapper.isError ? ({ icon: "alert" } as const) : {})}>
              {wrapper.isError ? "mainnet RPC unreachable" : "no readable Pyth account for this feed"}
            </Badge>
          )}
        </span>
      }
      footer={
        <>
          Two limits, both on chain: how long ago the keeper posted, and the quote&apos;s own age
          {staleAfter !== null && <> ({formatSlotAge(secsToSlots(staleAfter))} here)</>}.{" "}
          <DocLink to="PYTH.md">what the chain enforces →</DocLink>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-4">
        <Stat
          label="quote published"
          value={price.data ? formatAge(price.data.publishTime) : "—"}
          hint={quoteStale ? "the feed's own timestamp — stale" : "the feed's own timestamp"}
        />
        <Stat
          label="posted on devnet"
          value={fresh ? `${fresh.postedAgeSlots.toLocaleString()} slots ago` : "—"}
          hint={
            listing
              ? `limit ${Number(listing.maxPriceAgeSlots).toLocaleString()} slots${fresh && !fresh.postedFresh ? " — exceeded" : ""} · ${price.data?.from === "pyth" ? "Pyth's own account" : "the keeper's cache"}`
              : undefined
          }
        />
        <Stat
          label="underlying · TSLA equity"
          value={
            underlying.data
              ? formatPrice(underlying.data.price, underlying.data.expo)
              : underlying.isError
                ? "unavailable"
                : "—"
          }
          hint={
            underlying.data
              ? `published ${formatAge(underlying.data.publishTime)} · ${session.label}`
              : underlying.isError
                ? "mainnet RPC unreachable from this browser"
                : session.label
          }
        />
        <Stat
          label="wrapper basis"
          value={basis === null ? "—" : formatBasis(basis)}
          hint="xStock quote vs the equity, in basis points"
          delta={
            basis === null || Math.abs(basis) < 50
              ? undefined
              : { value: Math.abs(basis) >= 200 ? "wide" : "moderate", good: null }
          }
        />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-4">
        <Stat
          label="multiplier"
          value={mult.data ? mult.data.multiplier.toFixed(4) : "—"}
          hint="ScaledUiAmount on the mock mint"
        />
        <Stat
          label="haircut"
          value={credit.data ? `${Number(credit.data.haircutBps) / 100}%` : "—"}
          hint={credit.data ? `tenor ${formatSlotAge(Number(credit.data.tenorSlots))}` : undefined}
        />
        <Stat
          label="equity session"
          value={session.open ? "open" : "closed"}
          hint="NYSE regular hours, holidays not modelled"
        />
        <Stat
          label="verification"
          value={underlying.data ? underlying.data.verification : "—"}
          hint={
            underlying.data
              ? `account ${underlying.data.account.slice(0, 4)}…${underlying.data.account.slice(-4)}`
              : "Pyth receiver-owned account"
          }
        />
      </div>
    </Card>
  );
}

/**
 * The collateral mark: the wrapper quote the desk locks and seizes against, beside the underlying
 * equity feed read straight from Pyth's mainnet account. The quote's own timestamp is what tells
 * you whether the mark is fresh — not how recently the keeper posted it.
 */
import { Card } from "../../components/Card";
import { Stat } from "../../components/Stat";
import { Badge, ExplorerLink } from "../../components/ui";
import { formatAge, formatPrice, formatSlotAge } from "../../lib/format";
import { basisBps, FEEDS, formatBasis, nyseSession, useUnderlying } from "../../lib/pyth";
import { useCreditConfig, useDeployment, useMultiplier, usePrice, useSlot } from "../../lib/queries";

/** Fallback quote-age limit for a descriptor without listings; otherwise listing #0's on-chain `max_publish_age_secs`. */
export const QUOTE_STALE_AFTER_SECS = 3_600;

const PYTH_SHARD0_TSLAX = "GpoWLTd6GoisYxYgHz7mTcZvgnfJu4SN7T6PxWjgUTFY";

export function CollateralMark() {
  const dep = useDeployment();
  const credit = useCreditConfig();
  const slot = useSlot();
  const price = usePrice(dep.data?.feedId);
  const mult = useMultiplier(dep.data?.mockMint);
  const underlying = useUnderlying(FEEDS["Equity.US.TSLA/USD"]);
  const session = nyseSession();

  const staleAfter = dep.data?.listings[0]?.maxPublishAgeSecs ?? QUOTE_STALE_AFTER_SECS;
  const quoteAge = price.data ? Math.max(0, Math.round(Date.now() / 1000 - Number(price.data.publishTime))) : null;
  const quoteStale = quoteAge !== null && quoteAge > staleAfter;
  const basis = price.data && underlying.data ? basisBps(price.data, underlying.data) : null;

  return (
    <Card
      eyebrow="collateral mark · Pyth"
      title={price.data ? formatPrice(price.data.price, price.data.expo) : "—"}
      right={
        <span className="flex flex-wrap items-center gap-2">
          {quoteStale && (
            <Badge tone="warn" icon="alert">
              quote older than {formatSlotAge(staleAfter / 0.45)}
            </Badge>
          )}
          <ExplorerLink address={PYTH_SHARD0_TSLAX} cluster="mainnet-beta">
            Pyth TSLAX/USD account
          </ExplorerLink>
        </span>
      }
      footer={
        <>
          The keeper posts Pyth&apos;s <span className="mono">Crypto.TSLAX/USD</span> quote — Hermes when it holds an
          API key, otherwise the freshest of Pyth&apos;s own on-chain accounts — with the feed&apos;s own timestamp
          stored unmodified, so the quote&apos;s age is visible here. What is enforced on chain today is how recently
          the keeper <em>posted</em> ({credit.data ? formatSlotAge(Number(credit.data.maxPriceAge)) : "…"} max). The
          underlying <span className="mono">Equity.US.TSLA/USD</span> is read from Pyth&apos;s mainnet account in this
          browser; the overnight window opens when that market closes, which is why the 24/7 wrapper feed marks the
          collateral.
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
          value={
            price.data && slot.data !== undefined
              ? `${formatSlotAge(slot.data - Number(price.data.postedSlot))} ago`
              : "—"
          }
          hint={price.data ? `${price.data.posts.toString()} posts` : undefined}
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

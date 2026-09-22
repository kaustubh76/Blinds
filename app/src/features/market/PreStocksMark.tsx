/**
 * The PreStocks collateral mark: ANTHROPIC, a pre-IPO token, marked by PreStocks' published price and
 * held to the same two freshness rules as every listing. The mark on chain is a keeper-attested copy;
 * the implied (traded) price beside it comes from the keeper's last read (`/marks`) while the market
 * runs — the basis is informational and never on chain. Honest about both.
 */
import { useEffect, useRef } from "react";
import { Card } from "../../components/Card";
import { Stat } from "../../components/Stat";
import { Badge, ExplorerLink } from "../../components/ui";
import { config } from "../../config";
import { formatAge, formatPrice, formatSlotAge } from "../../lib/format";
import { basisBps, formatBasis } from "../../lib/pyth";
import { type MarkSnapshot, useDeployment, useMarks, useQuote, useSlot } from "../../lib/queries";

/** PreStocks' ANTHROPIC token on mainnet — never touched by the desk; the devnet listing is a twin. */
export const PRESTOCKS_ANTHROPIC_MINT = "Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw";
export const PRESTOCKS_URL = "https://prestocks.com";

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** The keeper's snapshot for this listing, matched on the feed id (the label's hash), never on a name. */
export function snapshotFor(
  marks: Record<string, MarkSnapshot> | null | undefined,
  feedIdHex: string,
): MarkSnapshot | null {
  if (!marks) return null;
  return Object.values(marks).find((m) => m.feed_id_hex === feedIdHex) ?? null;
}

export function PreStocksMark({ focus = false }: { focus?: boolean } = {}) {
  const dep = useDeployment();
  const listing = dep.data?.listings.find((l) => l.source === "prestocks");
  const price = useQuote(listing);
  const slot = useSlot();
  const marks = useMarks();
  const snap = listing ? snapshotFor(marks.data, hex(listing.feedId)) : null;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus && listing) ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focus, listing]);

  const limit = listing?.maxPublishAgeSecs ?? 172_800;
  const age = price.data ? Math.max(0, Math.round(Date.now() / 1000 - Number(price.data.publishTime))) : null;
  const stale = age !== null && age > limit;
  const implied = snap?.implied_e8 != null ? { price: BigInt(snap.implied_e8), expo: -8 } : null;
  const mark = snap ? { price: BigInt(snap.mark_e8), expo: -8 } : null;
  const basis = implied && mark ? basisBps(implied, mark) : null;
  const symbol = listing?.symbol.replace(/-mock$/, "") ?? "ANTHROPIC";

  return (
    <div ref={ref} id="prestocks" className="scroll-mt-20">
      <Card
        tone={focus ? "accent" : "default"}
        eyebrow={`collateral mark · PreStocks · ${symbol} (pre-IPO)`}
        title={
          price.data
            ? formatPrice(price.data.price, price.data.expo)
            : dep.data && !listing
              ? "no PreStocks listing"
              : "—"
        }
        right={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="borrow">PreStocks mark</Badge>
            {stale ? (
              <Badge tone="warn" icon="alert">
                mark older than {formatSlotAge(limit / 0.45)} · locks refused
              </Badge>
            ) : (
              <Badge tone="mute">attested · a keeper copy, stamped at fetch</Badge>
            )}
            <ExplorerLink address={PRESTOCKS_ANTHROPIC_MINT} cluster="mainnet-beta">
              mainnet mint
            </ExplorerLink>
            <a href={PRESTOCKS_URL} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
              prestocks.com →
            </a>
          </span>
        }
        footer={
          <>
            PreStocks tokenises pre-IPO companies; the desk lists its <span className="mono">{symbol}</span> next to a
            listed stock under one rate. The keeper reads PreStocks&apos; public <span className="mono">markPrice</span>{" "}
            and posts it as this listing&apos;s mark (<span className="mono">price_source = 2</span>) with the fetch
            time as its timestamp — a copy of a public number, attested by the keeper, not a signed feed. The chain
            refuses a lock or a seizure once the mark is older than {formatSlotAge(limit / 0.45)}; if the API stops, the
            last good mark is re-posted for six hours, then that rule halts new locks. The implied price is what the
            token trades at (<span className="mono">tokenPrice</span>), read beside the mark and served by the admin
            service while the market runs — never posted on chain. Devnet holds a twin of the token; the mainnet mint is
            not touched.
          </>
        }
      >
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="mark fetched"
            value={price.data ? formatAge(price.data.publishTime) : "—"}
            hint={
              stale ? "the keeper's fetch time — stale" : "the keeper's fetch time, stored as the quote's timestamp"
            }
          />
          <Stat
            label="posted on devnet"
            value={
              price.data && slot.data !== undefined
                ? `${formatSlotAge(slot.data - Number(price.data.postedSlot))} ago`
                : "—"
            }
            hint="read from the keeper's cache PDA"
          />
          <Stat
            label="implied price"
            value={implied ? formatPrice(implied.price, implied.expo) : "—"}
            hint={
              snap
                ? `PreStocks tokenPrice, read ${formatAge(snap.fetched_at)}`
                : config.adminUrl
                  ? marks.isFetching
                    ? "asking the keeper…"
                    : "the keeper did not answer — needs a market started after 22 Sep"
                  : "needs the admin service — open the dashboard from the market's ?admin= link"
            }
          />
          <Stat
            label="basis · implied vs mark"
            value={basis === null ? "—" : formatBasis(basis)}
            hint="how far the token trades from the published mark, in basis points"
            delta={
              basis === null || Math.abs(basis) < 50
                ? undefined
                : { value: Math.abs(basis) >= 200 ? "wide" : "moderate", good: null }
            }
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="haircut"
            value={listing ? `${Number(listing.haircutBps) / 100}%` : "—"}
            hint="collateral must cover this much of the loan — a pre-IPO mark is held to more than a listed stock"
          />
          <Stat
            label="quote limit"
            value={listing ? formatSlotAge(listing.maxPublishAgeSecs / 0.45) : "—"}
            hint={
              stale
                ? "exceeded: the chain refuses locks and seizures on this listing"
                : "the mark must be younger than this at every lock and seize"
            }
          />
          <Stat
            label="listing"
            value={listing ? <ExplorerLink address={listing.listing} cluster={config.cluster} /> : "—"}
            hint={
              listing ? (
                <>
                  escrow <ExplorerLink address={listing.escrow} cluster={config.cluster} />
                </>
              ) : undefined
            }
          />
          <Stat
            label="collateral mint"
            value={listing ? <ExplorerLink address={listing.cstockMint} cluster={config.cluster} /> : "—"}
            hint="cSTOCK: the confidential wrap of the devnet twin"
          />
        </div>
      </Card>
    </div>
  );
}

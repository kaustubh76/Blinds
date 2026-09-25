/**
 * The PreStocks collateral mark: ANTHROPIC, a pre-IPO token, marked by PreStocks' published price and
 * held to the same two freshness rules as every listing. The mark on chain is a keeper-attested copy;
 * the implied (traded) price beside it comes from the keeper's last read (`/marks`) while the market
 * runs — the basis is informational and never on chain. Honest about both.
 */
import { useEffect, useRef } from "react";
import { Card } from "../../components/Card";
import { Stat } from "../../components/Stat";
import { Badge, DocLink, ExplorerLink } from "../../components/ui";
import { config } from "../../config";
import { formatAge, formatPrice, formatSlotAge } from "../../lib/format";
import { basisBps, formatBasis } from "../../lib/pyth";
import { type MarkSnapshot, useDeployment, useMainnetMint, useMarks, useQuote, useSlot } from "../../lib/queries";
import { secsToSlots } from "../../lib/slotTime";

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
  // The real token, read from mainnet in this browser — the devnet listing is only a twin of it.
  const real = useMainnetMint(PRESTOCKS_ANTHROPIC_MINT);
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
  /** A company-scale figure: trillions, billions or millions, whichever reads. */
  const usdBig = (v: number) =>
    v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`;
  const valuationBasis =
    snap?.mark_valuation_usd && snap.implied_valuation_usd
      ? ((snap.implied_valuation_usd - snap.mark_valuation_usd) / snap.mark_valuation_usd) * 10_000
      : null;
  /**
   * The three extensions that carry the argument — the machinery the desk wraps, the rebase the proof
   * must carry, and the hook that stops a bonding curve quoting it — kept to whichever the chain
   * actually returned, so a rename upstream shortens the line instead of asserting something absent.
   */
  const named = ["confidentialTransferMint", "scaledUiAmountConfig", "transferHook"].filter((e) =>
    real.data?.extensions.includes(e),
  );
  const EXT_NOTE: Record<string, string> = {
    confidentialTransferMint: "confidential transfers — the same Token-2022 machinery the desk wraps with",
    scaledUiAmountConfig: "a rebasing multiplier, which is why the proof carries one",
    transferHook: "a transfer hook — and a hook or a fee is why a Meteora pool cannot quote in it",
  };

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
                mark older than {formatSlotAge(secsToSlots(limit))} · locks refused
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
            Attested mark, not a signed feed · stale after {formatSlotAge(secsToSlots(limit))} · a devnet twin, not the
            mainnet mint. <DocLink to="LISTINGS.md">how a mark is posted →</DocLink>
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
                : dep.data?.adminUrl || config.adminUrl
                  ? marks.isFetching
                    ? "asking the keeper…"
                    : "the keeper did not answer — needs a market started after 22 Sep"
                  : "needs the admin service — open the dashboard from the market's ?admin= link"
            }
          />
          <Stat
            label="basis · implied vs mark"
            value={basis === null ? "—" : formatBasis(basis)}
            hint={
              valuationBasis !== null && snap?.mark_valuation_usd
                ? `${usdBig(snap.mark_valuation_usd)} marked vs ${usdBig(snap.implied_valuation_usd ?? 0)} implied`
                : "how far the token trades from the published mark"
            }
            delta={
              basis === null || Math.abs(basis) < 50
                ? undefined
                : { value: Math.abs(basis) >= 200 ? "wide" : "moderate", good: null }
            }
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Stat
            label="haircut"
            value={listing ? `${Number(listing.haircutBps) / 100}%` : "—"}
            hint="collateral must cover this much of the loan — a pre-IPO mark is held to more than a listed stock"
          />
          <Stat
            label="quote limit"
            value={listing ? formatSlotAge(secsToSlots(listing.maxPublishAgeSecs)) : "—"}
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
            label="the real token · mainnet"
            value={
              real.data ? `${real.data.supply.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${symbol}` : "—"
            }
            hint={
              real.data
                ? `${real.data.program.startsWith("Tokenz") ? "Token-2022" : real.data.program.slice(0, 4)} · ${real.data.decimals} dp · read from mainnet in this browser`
                : real.isError
                  ? "mainnet RPC unreachable from this browser"
                  : "reading the mint…"
            }
          />
          <Stat
            label="collateral mint"
            value={listing ? <ExplorerLink address={listing.cstockMint} cluster={config.cluster} /> : "—"}
            hint="cSTOCK: the confidential wrap of the devnet twin"
          />
        </div>
        {real.data && (
          <p className="mt-3 text-xs leading-relaxed text-ink-3">
            {real.data.extensions.length} Token-2022 extensions
            {named.length > 0 && (
              <>
                , among them{" "}
                {named.map((e, i) => (
                  <span key={e}>
                    <span className="mono text-ink-2" title={EXT_NOTE[e]}>
                      {e}
                    </span>
                    {i < named.length - 1 ? " · " : ""}
                  </span>
                ))}
              </>
            )}
            {real.data.extensions.includes("transferHook")
              ? " — a transfer hook is why a bonding curve cannot quote in it. "
              : " — which is why this desk wraps a twin. "}
            <DocLink to="LISTINGS.md">why a twin →</DocLink>
          </p>
        )}
      </Card>
    </div>
  );
}

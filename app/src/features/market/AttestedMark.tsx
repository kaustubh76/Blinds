/**
 * One attested collateral mark, whichever provider publishes it: the price the keeper copied and the
 * chain holds, held to the same two freshness rules as every listing and judged here with the chain's
 * own helper; the price the token actually trades at beside it, from the keeper's last read
 * (`/marks`) while the market runs — the basis is informational and never on chain. Honest about both.
 *
 * This was the PreStocks card. Tag 2 now carries two providers, so what differs between them is data
 * (`PROVIDERS` below) and everything that is the same — the two rules, the twin, the real mint read in
 * the reader's own browser — is written once. The mint comes from the descriptor, not from a constant
 * here: a second listing made a hardcoded address untenable, and it was never this file's fact to know.
 */
import { quoteFreshness } from "@thewindow/solana-sdk";
import { useEffect, useRef } from "react";
import { Card } from "../../components/Card";
import { Stat } from "../../components/Stat";
import { Badge, DocLink, ExplorerLink } from "../../components/ui";
import { config } from "../../config";
import type { ListingView } from "../../lib/chain";
import { displaySymbol, formatAge, formatPrice, formatSlotAge } from "../../lib/format";
import { basisBps, formatBasis } from "../../lib/pyth";
import { type MarkSnapshot, useJupiterMark, useMainnetMint, useMarks, useQuote, useSlot } from "../../lib/queries";
import { secsToSlots } from "../../lib/slotTime";

export const PRESTOCKS_URL = "https://prestocks.com";

/** What differs between one attested-mark provider and another. Everything else is shared. */
interface ProviderCopy {
  /** How the provider is written on screen. */
  name: string;
  /** A parenthetical after the symbol, when the asset class is the point. */
  qualifier: string;
  site: { href: string; label: string };
  /** The field the implied price comes from, and what that number is. */
  implied: { field: string; is: string };
  basisLabel: string;
  basisHint: string;
  haircutHint: string;
  /** Why this desk wraps a twin rather than the mint itself. */
  twinReason: string;
}

const PROVIDERS: Record<string, ProviderCopy> = {
  prestocks: {
    name: "PreStocks",
    qualifier: "pre-IPO",
    site: { href: PRESTOCKS_URL, label: "prestocks.com →" },
    implied: { field: "tokenPrice", is: "the price the token trades at" },
    basisLabel: "basis · traded vs the mark",
    basisHint: "how far the token trades from the published mark",
    haircutHint: "collateral must cover this much of the loan — a pre-IPO mark is held to more than a listed stock",
    twinReason: "which is why this desk wraps a twin",
  },
  jupiter: {
    name: "Jupiter",
    qualifier: "xStocks",
    site: { href: "https://jup.ag", label: "jup.ag →" },
    implied: { field: "stockData.price", is: "the underlying equity's own price" },
    basisLabel: "basis · the token vs the stock",
    basisHint: "how far the tokenized stock trades from the stock itself",
    haircutHint: "collateral must cover this much of the loan, the same as any listed stock on this desk",
    twinReason: "which is why this desk wraps a twin",
  },
};

/** A provider the desk has not met keeps the label its feed id is seeded on — never a prettier guess. */
function copyFor(provider: string | null): ProviderCopy {
  const known = provider ? PROVIDERS[provider] : undefined;
  if (known) return known;
  return {
    name: provider ?? "an attested source",
    qualifier: "attested",
    site: { href: "", label: "" },
    implied: { field: "the provider's traded price", is: "the price the token trades at" },
    basisLabel: "basis · traded vs the mark",
    basisHint: "how far the token trades from the published mark",
    haircutHint: "collateral must cover this much of the loan",
    twinReason: "which is why this desk wraps a twin",
  };
}

const hex = (b: Uint8Array) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/** The keeper's snapshot for this listing, matched on the feed id (the label's hash), never on a name. */
export function snapshotFor(
  marks: Record<string, MarkSnapshot> | null | undefined,
  feedIdHex: string,
): MarkSnapshot | null {
  if (!marks) return null;
  return Object.values(marks).find((m) => m.feed_id_hex === feedIdHex) ?? null;
}

/** A company-scale figure: trillions, billions or millions, whichever reads. */
const usdBig = (v: number) =>
  v >= 1e12 ? `$${(v / 1e12).toFixed(2)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : `$${(v / 1e6).toFixed(0)}M`;

export function AttestedMark({ listing, focus = false }: { listing: ListingView; focus?: boolean }) {
  const price = useQuote(listing);
  const slot = useSlot();
  const marks = useMarks();
  // Jupiter answers a page origin directly, so this card keeps its traded price and its basis with
  // no keeper running and without reaching for another deployment's function. The keeper's snapshot
  // still wins when there is one: that is the view matching what was posted on chain.
  const jup = useJupiterMark(listing.provider === "jupiter" ? listing.sourceMint : null);
  const posted = snapshotFor(marks.data, hex(listing.feedId));
  const snap: MarkSnapshot | null =
    posted ??
    (jup.data
      ? {
          key: listing.key,
          symbol: listing.symbol,
          source: "jupiter-live",
          feed_id_hex: hex(listing.feedId),
          url: "https://lite-api.jup.ag/price/v3",
          mark_e8: Math.round(jup.data.usd * 1e8),
          implied_e8: jup.data.stock === null ? null : Math.round(jup.data.stock * 1e8),
          basis_bps: null,
          ...(jup.data.mcap === null ? {} : { mark_valuation_usd: jup.data.mcap }),
          fetched_at: jup.data.fetchedAt,
        }
      : null);
  // The real token, read from mainnet in this browser — the devnet listing is only a twin of it.
  const real = useMainnetMint(listing.sourceMint ?? undefined);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focus) ref.current?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focus]);

  const c = copyFor(listing.provider);
  const limit = listing.maxPublishAgeSecs;
  // Both of the chain's rules, from the SDK helper `lock_collateral` mirrors: a mark young enough
  // (`max_publish_age_secs`) AND posted recently enough (`max_price_age_slots`). Judging only the first
  // let this card show the all-good badge while a lock was certain to fail PriceStale.
  const fresh =
    price.data && slot.data !== undefined
      ? quoteFreshness({
          listing: { maxPriceAge: BigInt(listing.maxPriceAgeSlots), maxPublishAgeSecs: BigInt(limit) },
          price: price.data,
          slot: slot.data,
          nowSecs: Math.floor(Date.now() / 1000),
        })
      : null;
  const stale = fresh ? !fresh.quoteFresh : null;
  // Where the traded price came from: the keeper's last read (matching what it posted on chain) or
  // the provider live through this site's own function. Never conflated — the mark above is the chain's.
  const live = snap?.source?.endsWith("-live") ?? false;
  const implied = snap?.implied_e8 != null ? { price: BigInt(snap.implied_e8), expo: -8 } : null;
  const mark = snap ? { price: BigInt(snap.mark_e8), expo: -8 } : null;
  const basis = implied && mark ? basisBps(implied, mark) : null;
  const sym = displaySymbol(listing);
  // Each valuation stands alone: this used to require both, so a provider that publishes one
  // company-scale figure showed none of it.
  const valuations = [
    snap?.mark_valuation_usd ? `${usdBig(snap.mark_valuation_usd)} at the mark` : null,
    snap?.implied_valuation_usd ? `${usdBig(snap.implied_valuation_usd)} implied` : null,
  ].filter(Boolean);
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
    <div ref={ref} id={listing.provider ?? listing.key} className="scroll-mt-20">
      <Card
        tone={focus ? "accent" : "default"}
        eyebrow={`collateral mark · ${c.name} · ${sym} (${c.qualifier})`}
        title={price.data ? formatPrice(price.data.price, price.data.expo) : "—"}
        right={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone="borrow">{c.name} mark</Badge>
            {fresh ? (
              <Badge tone={fresh.usable ? "good" : "warn"} icon={fresh.usable ? "check" : "alert"}>
                {fresh.usable
                  ? "attested · the chain would accept a lock"
                  : `${stale ? `mark older than ${formatSlotAge(secsToSlots(limit))}` : "posted too long ago"} · locks refused`}
              </Badge>
            ) : (
              <Badge tone="mute">attested · a keeper copy, stamped at fetch</Badge>
            )}
            {listing.sourceMint && (
              <ExplorerLink address={listing.sourceMint} cluster="mainnet-beta">
                mainnet mint
              </ExplorerLink>
            )}
            {c.site.href && (
              <a href={c.site.href} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                {c.site.label}
              </a>
            )}
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
            value={fresh ? `${fresh.postedAgeSlots.toLocaleString()} slots ago` : "—"}
            hint={`the chain's own unit · limit ${Number(listing.maxPriceAgeSlots).toLocaleString()} slots${
              fresh && !fresh.postedFresh ? " — exceeded" : ""
            }`}
          />
          <Stat
            label={listing.provider === "jupiter" ? "the stock itself" : "implied price"}
            value={implied ? formatPrice(implied.price, implied.expo) : "—"}
            hint={
              snap
                ? `${c.name} ${c.implied.field} · ${live ? `live from ${c.name}` : "the keeper's last read"} ${formatAge(snap.fetched_at)}`
                : config.adminUrl
                  ? marks.isFetching
                    ? "asking the keeper…"
                    : "the keeper did not answer — the market is not running"
                  : `${c.implied.is} — needs the admin service, from the market's ?admin= link`
            }
          />
          <Stat
            label={c.basisLabel}
            value={basis === null ? "—" : formatBasis(basis)}
            hint={valuations.length > 0 ? `${valuations.join(" vs ")}${live ? " · live" : ""}` : c.basisHint}
            delta={
              basis === null || Math.abs(basis) < 50
                ? undefined
                : { value: Math.abs(basis) >= 200 ? "wide" : "moderate", good: null }
            }
          />
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Stat label="haircut" value={`${Number(listing.haircutBps) / 100}%`} hint={c.haircutHint} />
          <Stat
            label="quote limit"
            value={formatSlotAge(secsToSlots(limit))}
            hint={
              stale
                ? "exceeded: the chain refuses locks and seizures on this listing"
                : "the mark must be younger than this at every lock and seize"
            }
          />
          <Stat
            label="listing"
            value={<ExplorerLink address={listing.listing} cluster={config.cluster} />}
            hint={
              <>
                escrow <ExplorerLink address={listing.escrow} cluster={config.cluster} />
              </>
            }
          />
          <Stat
            label="the real token · mainnet"
            value={
              real.data
                ? `${real.data.supply.toLocaleString("en-US", { maximumFractionDigits: 0 })} ${listing.sourceSymbol ?? sym}`
                : "—"
            }
            hint={
              real.data
                ? `${real.data.program.startsWith("Tokenz") ? "Token-2022" : real.data.program.slice(0, 4)} · ${real.data.decimals} dp · read from mainnet in this browser`
                : real.isError
                  ? "mainnet RPC unreachable from this browser"
                  : listing.sourceMint
                    ? "reading the mint…"
                    : "this deployment records no mainnet mint for the twin"
            }
          />
          <Stat
            label="collateral mint"
            value={<ExplorerLink address={listing.cstockMint} cluster={config.cluster} />}
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
              : ` — ${c.twinReason}. `}
            <DocLink to="LISTINGS.md">why a twin →</DocLink>
          </p>
        )}
      </Card>
    </div>
  );
}

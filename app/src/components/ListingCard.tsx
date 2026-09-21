/** One eligible collateral as a card: what it is, who marks it, what it is worth, whether the chain would accept it now. */
import type { credit as creditNs } from "@thewindow/solana-sdk";
import { quoteFreshness } from "@thewindow/solana-sdk";
import type { ListingView } from "../lib/chain";
import { formatAge, formatPrice } from "../lib/format";
import { sourceLabel } from "../lib/listings";
import { Icon } from "./Icon";
import { Pill } from "./ui";

type PriceCache = Pick<creditNs.PriceCache, "price" | "expo" | "publishTime" | "postedSlot">;

const SOURCE_TONE: Record<string, "accent" | "lend" | "borrow" | "mute"> = {
  pyth: "accent",
  prestocks: "borrow",
  mock: "mute",
};

export function ListingCard({
  listing: l,
  price,
  slot,
  selected = false,
  compact = false,
  onSelect,
}: {
  listing: ListingView;
  price: PriceCache | null | undefined;
  slot: number | undefined;
  selected?: boolean;
  compact?: boolean;
  onSelect?: ((key: string) => void) | undefined;
}) {
  const fresh =
    price && slot !== undefined
      ? quoteFreshness({
          listing: { maxPriceAge: BigInt(l.maxPriceAgeSlots), maxPublishAgeSecs: BigInt(l.maxPublishAgeSecs) },
          price,
          slot,
          nowSecs: Math.floor(Date.now() / 1000),
        })
      : null;
  const attested = l.source === "prestocks";
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-base font-semibold text-ink-1">{l.symbol.replace(/-mock$/, "")}</div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            <Pill tone={SOURCE_TONE[l.source] ?? "mute"}>{sourceLabel(l)}</Pill>
            {attested && (
              <span
                className="text-[11px] text-ink-3"
                title="the keeper copies a public mark and stamps it with the fetch time"
              >
                attested
              </span>
            )}
          </div>
        </div>
        {selected && (
          <span className="text-accent">
            <Icon name="check" size={18} />
          </span>
        )}
      </div>
      <div className={`mt-4 flex items-end justify-between gap-3 ${compact ? "" : "min-h-[52px]"}`}>
        <div>
          <div className="num text-2xl font-semibold tracking-tight text-ink-1">
            {price ? formatPrice(price.price, price.expo) : "—"}
          </div>
          <div className="text-xs text-ink-3">
            {price ? `quote ${formatAge(price.publishTime)}` : price === null ? "no quote yet" : "loading"} · haircut{" "}
            {Number(l.haircutBps) / 100}%
          </div>
        </div>
        {fresh ? (
          <Pill tone={fresh.usable ? "good" : "warn"} icon={fresh.usable ? "check" : "clock"}>
            {fresh.usable ? "accepting" : fresh.postedFresh ? "quote stale" : "post stale"}
          </Pill>
        ) : (
          <Pill tone="mute">…</Pill>
        )}
      </div>
    </>
  );
  const cls = `w-full rounded-[var(--radius-lg)] border p-4 text-left transition-colors ${
    selected ? "border-accent bg-accent-soft/40" : "border-line bg-surface-1 hover:border-line-strong"
  }`;
  return onSelect ? (
    <button type="button" onClick={() => onSelect(l.key)} aria-pressed={selected} className={cls}>
      {body}
    </button>
  ) : (
    <div className={cls}>{body}</div>
  );
}

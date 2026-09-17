/** The collateral schedule as a segmented control: which listing the desk works right now. */
import type { ListingView } from "../lib/chain";
import { sourceLabel } from "../lib/listings";

export function ListingPicker({
  listings,
  selected,
  onSelect,
  disabled = false,
}: {
  listings: ListingView[];
  selected: ListingView | undefined;
  onSelect: (key: string) => void;
  disabled?: boolean;
}) {
  if (listings.length <= 1) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="mono text-[11px] uppercase tracking-[0.14em] text-ink-3">collateral</span>
      <div
        className="flex rounded-[var(--radius-md)] border border-line p-0.5"
        role="radiogroup"
        aria-label="Collateral"
      >
        {listings.map((l) => {
          const on = l.key === selected?.key;
          return (
            <button
              key={l.key}
              type="button"
              aria-pressed={on}
              disabled={disabled}
              onClick={() => onSelect(l.key)}
              className={`rounded-[6px] px-3 py-1 text-sm transition-colors disabled:opacity-60 ${
                on ? "bg-surface-2 text-ink-1" : "text-ink-3 hover:text-ink-1"
              }`}
              title={`${sourceLabel(l.source)} · haircut ${Number(l.haircutBps) / 100}%`}
            >
              {l.symbol}
              <span className="mono ml-1.5 text-[10px] text-ink-3">{Number(l.haircutBps) / 100}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

import { formatAge, formatPrice, formatRate } from "../lib/format";
import { useTicker } from "../lib/useTicker";
import { PhaseDot, WindowClock } from "./WindowClock";

/** One-line live strip. Figures from polls; the small ring interpolates. */
export function Ticker() {
  const t = useTicker();
  return (
    <div className="mono flex items-center gap-4 whitespace-nowrap text-xs text-ink-2">
      <span className="flex items-baseline gap-1.5">
        <span className="text-ink-3">xONIA</span>
        <span className="text-sm font-medium text-ink-1">{t.xonia !== null ? formatRate(t.xonia) : "—"}</span>
        {t.stale && <span className="text-status-warning">stale τ{t.tau}</span>}
      </span>
      <span className="hidden items-baseline gap-1.5 sm:flex">
        <span className="text-ink-3">TSLAx</span>
        <span className="text-sm font-medium text-ink-1">
          {t.price ? formatPrice(t.price.price, t.price.expo) : "—"}
        </span>
        {t.price && <span className="text-ink-3">{formatAge(t.price.publishTime)}</span>}
      </span>
      <span className="flex items-center gap-2">
        <WindowClock clock={t.clock} size={18} detail={false} />
        <PhaseDot phase={t.clock.phase} />
        <span className="text-ink-2">
          {t.clock.phase === "open" && t.clock.secondsLeft !== null
            ? `closes in ${Math.floor(t.clock.secondsLeft / 60)}:${String(t.clock.secondsLeft % 60).padStart(2, "0")}`
            : t.clock.phase === "overdue"
              ? "paused"
              : t.clock.phase === "printed" && t.clock.rStar !== null
                ? `printed ${formatRate(t.clock.rStar)}`
                : t.clock.phase.replace("notrade", "no trade")}
        </span>
      </span>
    </div>
  );
}

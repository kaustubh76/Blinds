/**
 * The header's live status. It was one of two exports here; the other was a full-width ticker strip
 * that nothing ever rendered, so this file is now what its name says.
 */
import { formatRate } from "../lib/format";
import { useTicker } from "../lib/useTicker";
import { WindowClock } from "./WindowClock";

/** The header's compact live status: the phase dot, the countdown or the last print, the rate. */
export function StatusPill() {
  const t = useTicker();
  const phase =
    t.clock.phase === "open" && t.clock.secondsLeft !== null
      ? `closes in ${Math.floor(t.clock.secondsLeft / 60)}:${String(t.clock.secondsLeft % 60).padStart(2, "0")}`
      : t.clock.phase === "overdue"
        ? "paused"
        : t.clock.phase === "printed" && t.clock.rStar !== null
          ? `printed ${formatRate(t.clock.rStar)}`
          : t.clock.phase.replace("notrade", "no trade");
  return (
    <a
      href="#/market"
      className="flex items-center gap-2 rounded-full border border-line bg-surface-1 px-3 py-1 text-xs text-ink-2 hover:text-ink-1"
      title="the live window"
    >
      <WindowClock clock={t.clock} size={16} detail={false} />
      <span className="whitespace-nowrap">{phase}</span>
      <span className="text-ink-3">·</span>
      <span className="whitespace-nowrap">
        xONIA <span className="num font-medium text-ink-1">{t.xonia !== null ? formatRate(t.xonia) : "—"}</span>
      </span>
    </a>
  );
}

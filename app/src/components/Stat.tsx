import type { ReactNode } from "react";
import { Sparkline } from "./Sparkline";

/**
 * Stat tile. `hero` is the one figure a view leads with: ≥48px, proportional digits (tabular digits
 * make a big `121` look loose). Deltas are signed and coloured by direction × whether up is good.
 */
export function Stat({
  label,
  value,
  unit,
  hint,
  delta,
  trend,
  hero = false,
  className = "",
}: {
  label: ReactNode;
  value: ReactNode;
  unit?: ReactNode;
  hint?: ReactNode;
  delta?: { value: string; good: boolean | null } | undefined;
  trend?: number[];
  hero?: boolean;
  className?: string;
}) {
  const deltaTone = delta?.good === null ? "text-ink-2" : delta?.good ? "text-status-good" : "text-status-serious";
  return (
    <div className={`min-w-0 ${className}`}>
      <div className="mono text-[11px] uppercase tracking-[0.14em] text-ink-3">{label}</div>
      <div className="mt-1 flex items-baseline gap-2">
        <div
          className={
            hero
              ? "text-[56px] leading-none font-semibold tracking-tight text-ink-1"
              : "text-2xl font-semibold text-ink-1"
          }
        >
          {value}
        </div>
        {unit && <div className="text-sm text-ink-3">{unit}</div>}
        {delta && <div className={`text-sm ${deltaTone}`}>{delta.value}</div>}
      </div>
      {(hint || trend) && (
        <div className="mt-2 flex items-center gap-3 text-xs text-ink-2">
          {trend && trend.length > 1 && <Sparkline points={trend} />}
          {hint && <div className="min-w-0">{hint}</div>}
        </div>
      )}
    </div>
  );
}

/** The desk's left rail: where you are in the flow, at a glance. */
import { Icon } from "./Icon";

export type RailState = "done" | "active" | "todo" | "blocked";

export function ProgressRail({
  steps,
  onPick,
}: {
  steps: Array<{ title: string; state: RailState; hint?: string }>;
  onPick?: (i: number) => void;
}) {
  return (
    <ol className="grid gap-1">
      {steps.map((s, i) => {
        const dot =
          s.state === "done"
            ? "bg-status-good text-white"
            : s.state === "active"
              ? "bg-accent text-accent-ink"
              : s.state === "blocked"
                ? "bg-status-warning/20 text-status-warning"
                : "bg-surface-2 text-ink-3";
        const text = s.state === "todo" ? "text-ink-3" : "text-ink-1";
        const inner = (
          <>
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${dot}`}
            >
              {s.state === "done" ? <Icon name="check" size={12} /> : i + 1}
            </span>
            <span className="min-w-0">
              <span className={`block text-sm font-medium ${text}`}>{s.title}</span>
              {s.hint && <span className="block truncate text-xs text-ink-3">{s.hint}</span>}
            </span>
          </>
        );
        return (
          <li key={s.title}>
            {onPick ? (
              <button
                type="button"
                onClick={() => onPick(i)}
                className={`flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2 py-2 text-left hover:bg-surface-2 ${
                  s.state === "active" ? "bg-surface-2" : ""
                }`}
              >
                {inner}
              </button>
            ) : (
              <div
                className={`flex items-center gap-3 rounded-[var(--radius-md)] px-2 py-2 ${s.state === "active" ? "bg-surface-2" : ""}`}
              >
                {inner}
              </div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

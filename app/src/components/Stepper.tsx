import type { ReactNode } from "react";
import { Icon } from "./Icon";

export type StepState = "todo" | "active" | "done" | "blocked";

export interface Step {
  title: string;
  state: StepState;
  /** For `blocked`, the reason; otherwise a one-line explanation. */
  detail?: ReactNode;
  /** The step's own controls; hidden when blocked. */
  action?: ReactNode;
}

/** Numbered vertical steps. A blocked step says why and offers nothing to click. */
export function Stepper({ steps }: { steps: Step[] }) {
  return (
    <ol className="grid gap-3">
      {steps.map((s, i) => {
        const ring =
          s.state === "done"
            ? "border-status-good/60 text-status-good"
            : s.state === "active"
              ? "border-accent text-accent"
              : "border-line text-ink-3";
        return (
          <li
            key={s.title}
            data-state={s.state}
            className={`rounded-[var(--radius-lg)] border bg-surface-1 px-5 py-4 ${s.state === "active" ? "border-accent/50" : "border-line"} ${
              s.state === "blocked" || s.state === "todo" ? "opacity-80" : ""
            }`}
          >
            <div className="flex items-start gap-3">
              <span
                className={`mono mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[11px] ${ring}`}
              >
                {s.state === "done" ? (
                  <Icon name="check" size={12} />
                ) : s.state === "blocked" ? (
                  <Icon name="lock" size={11} />
                ) : (
                  i + 1
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <h3 className="text-sm font-medium text-ink-1">{s.title}</h3>
                  {s.state === "blocked" && s.detail && <span className="text-xs text-status-warning">{s.detail}</span>}
                </div>
                {s.state !== "blocked" && s.detail && (
                  <p className="mt-1 max-w-[70ch] text-xs leading-relaxed text-ink-2">{s.detail}</p>
                )}
                {s.state !== "blocked" && s.action && <div className="mt-3">{s.action}</div>}
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

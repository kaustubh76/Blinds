import type { StepReport } from "@thewindow/solana-sdk";
import { Icon } from "./Icon";
import { ExplorerLink } from "./ui";

/** The transactions of a plan as they land: state glyph, label, signature → explorer. */
export function TxTimeline({ steps, cluster }: { steps: StepReport[]; cluster: string }) {
  if (steps.length === 0) return null;
  return (
    <ol className="mt-3 space-y-1.5">
      {steps.map((s) => (
        <li key={s.index} className="flex items-center gap-2 text-xs" data-state={s.state}>
          <span
            className={
              s.state === "confirmed"
                ? "text-status-good"
                : s.state === "failed"
                  ? "text-status-critical"
                  : "text-accent"
            }
          >
            {s.state === "confirmed" ? (
              <Icon name="check" size={12} />
            ) : s.state === "failed" ? (
              <Icon name="x" size={12} />
            ) : (
              <Icon name="refresh" size={12} className="animate-spin" />
            )}
          </span>
          <span className="mono text-ink-3">{s.index + 1}</span>
          <span className="text-ink-1">{s.label}</span>
          {s.signature && <ExplorerLink address={s.signature} cluster={cluster} kind="tx" />}
          {s.error && <span className="text-status-critical">{s.error}</span>}
        </li>
      ))}
    </ol>
  );
}

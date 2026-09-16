import { LoanStatus } from "@thewindow/solana-sdk";
import { Icon, type IconName } from "./Icon";

/**
 * A loan's life as a track: Pending → Requested → Deposited → Locked → Active → Repaid | Defaulted.
 * Status colours carry a glyph and a label, never colour alone.
 */
const STOPS = [
  { status: LoanStatus.Pending, label: "matched" },
  { status: LoanStatus.Requested, label: "solvency proven" },
  { status: LoanStatus.Deposited, label: "collateral in escrow" },
  { status: LoanStatus.Locked, label: "locked" },
  { status: LoanStatus.Active, label: "funded" },
] as const;

export type Terminal = "repaid" | "defaulted" | null;

export function stopFor(status: number): { index: number; terminal: Terminal } {
  if (status === LoanStatus.Repaid) return { index: STOPS.length, terminal: "repaid" };
  if (status === LoanStatus.Defaulted) return { index: STOPS.length, terminal: "defaulted" };
  const i = STOPS.findIndex((s) => s.status === status);
  return { index: i < 0 ? 0 : i, terminal: null };
}

export function LifecycleTrack({ status, matured = false }: { status: number; matured?: boolean }) {
  const { index, terminal } = stopFor(status);
  const items: Array<{ label: string; state: "done" | "current" | "todo"; tone: string; icon: IconName }> = STOPS.map(
    (s, i) => ({
      label: s.label,
      state: terminal ? "done" : i < index ? "done" : i === index ? "current" : "todo",
      tone: "",
      icon: "check",
    }),
  );
  const end = terminal
    ? terminal === "repaid"
      ? { label: "repaid", tone: "text-status-good border-status-good/60", icon: "check" as IconName }
      : {
          label: "defaulted · collateral seized",
          tone: "text-status-critical border-status-critical/60",
          icon: "x" as IconName,
        }
    : {
        label: matured ? "matured · seizable" : "repaid or seized",
        tone: matured ? "text-status-serious border-status-serious/60" : "text-ink-3 border-line",
        icon: (matured ? "alert" : "clock") as IconName,
      };
  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 text-[11px]" aria-label="loan lifecycle">
      {items.map((it, i) => (
        <li key={it.label} className="flex items-center gap-1" data-state={it.state}>
          <span
            className={`flex h-4 w-4 items-center justify-center rounded-full border ${
              it.state === "done"
                ? "border-status-good/60 text-status-good"
                : it.state === "current"
                  ? "border-accent text-accent"
                  : "border-line text-ink-3"
            }`}
          >
            {it.state === "done" ? (
              <Icon name="check" size={9} />
            ) : (
              <span className="h-1 w-1 rounded-full bg-current" />
            )}
          </span>
          <span className={it.state === "todo" ? "text-ink-3" : it.state === "current" ? "text-ink-1" : "text-ink-2"}>
            {it.label}
          </span>
          {i < items.length - 1 && <span className="mx-1 h-px w-4 bg-line" />}
        </li>
      ))}
      <li className="flex items-center gap-1" data-state={terminal ? "done" : "todo"}>
        <span className="mx-1 h-px w-4 bg-line" />
        <span className={`flex h-4 w-4 items-center justify-center rounded-full border ${end.tone}`}>
          <Icon name={end.icon} size={9} />
        </span>
        <span className={terminal ? end.tone.split(" ")[0] : "text-ink-3"}>{end.label}</span>
      </li>
    </ol>
  );
}

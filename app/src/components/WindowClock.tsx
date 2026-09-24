/**
 * The heartbeat: an SVG ring that fills as the open window's slots elapse, then closes, then shows
 * the print being proven tick by tick, then stamps the rate. Every figure comes from a poll; only
 * the ring's motion is interpolated.
 */
import { formatCountdown, formatRate, formatUsdc } from "../lib/format";
import type { Clock, Phase } from "../lib/useWindowClock";

const PHASE_LABEL: Record<Phase, string> = {
  loading: "connecting",
  open: "window open",
  overdue: "window overdue",
  closed: "window closed",
  printing: "printing",
  printed: "printed",
  notrade: "no trade",
  idle: "between windows",
};

export function WindowClock({ clock, size = 160, detail = true }: { clock: Clock; size?: number; detail?: boolean }) {
  const stroke = Math.max(3, Math.round(size / 18));
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const { phase } = clock;
  // OPEN fills the ring; PRINTING shows proven/nonzero as the filled fraction; the rest is full.
  const fraction =
    phase === "open" ? clock.progress : phase === "printing" && clock.nonzero > 0 ? clock.attested / clock.nonzero : 1;
  const ringColor =
    phase === "open"
      ? "var(--color-lend)"
      : phase === "overdue"
        ? "var(--color-status-warning)"
        : phase === "printing"
          ? "var(--color-accent)"
          : phase === "printed"
            ? "var(--color-accent)"
            : phase === "notrade"
              ? "var(--color-ink-3)"
              : "var(--color-line-strong)";
  const big = size >= 120;
  return (
    <div className="flex max-w-full flex-wrap items-center justify-center gap-4" data-phase={phase}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0" aria-hidden="true">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-line)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={ringColor}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - fraction)}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          className="ring-progress"
        />
        {big && (
          <g fill="var(--color-ink-1)" fontFamily="var(--font-sans)" textAnchor="middle">
            {phase === "open" && (
              <>
                <text x="50%" y="46%" fontSize={size / 5} fontWeight={600}>
                  {clock.secondsLeft === null ? "—" : formatCountdown(clock.secondsLeft)}
                </text>
                <text x="50%" y="62%" fontSize={size / 13} fill="var(--color-ink-3)">
                  {clock.bids} sealed bid{clock.bids === 1 ? "" : "s"}
                </text>
              </>
            )}
            {phase === "printing" && (
              <>
                <text x="50%" y="46%" fontSize={size / 5} fontWeight={600}>
                  {clock.attested}/{clock.nonzero}
                </text>
                <text x="50%" y="62%" fontSize={size / 13} fill="var(--color-ink-3)">
                  ticks proven
                </text>
              </>
            )}
            {phase === "printed" && clock.rStar !== null && (
              <>
                <text x="50%" y="46%" fontSize={size / 5} fontWeight={600} className="animate-stamp">
                  {formatRate(clock.rStar)}
                </text>
                <text x="50%" y="62%" fontSize={size / 13} fill="var(--color-ink-3)">
                  {clock.matched !== null ? formatUsdc(clock.matched) : ""}
                </text>
              </>
            )}
            {phase === "overdue" && (
              <>
                <text x="50%" y="46%" fontSize={size / 7} fontWeight={600}>
                  paused
                </text>
                <text x="50%" y="62%" fontSize={size / 13} fill="var(--color-ink-3)">
                  {clock.bids} sealed bid{clock.bids === 1 ? "" : "s"}
                </text>
              </>
            )}
            {(phase === "closed" || phase === "notrade" || phase === "idle" || phase === "loading") && (
              <text x="50%" y="54%" fontSize={size / 11} fill="var(--color-ink-3)">
                {PHASE_LABEL[phase]}
              </text>
            )}
          </g>
        )}
      </svg>
      {detail && (
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <PhaseDot phase={phase} />
            <span className="text-sm font-medium text-ink-1">{PHASE_LABEL[phase]}</span>
            {clock.epoch !== null && <span className="mono text-xs text-ink-3">epoch {clock.epoch.toString()}</span>}
          </div>
          <p className="mt-1 max-w-[28ch] text-xs leading-relaxed text-ink-2">{phaseCopy(clock)}</p>
        </div>
      )}
    </div>
  );
}

export function PhaseDot({ phase }: { phase: Phase }) {
  const color =
    phase === "open"
      ? "bg-lend"
      : phase === "printing" || phase === "printed"
        ? "bg-accent"
        : phase === "overdue"
          ? "bg-status-warning"
          : "bg-ink-3";
  return (
    <span className="relative inline-flex h-2 w-2">
      {(phase === "open" || phase === "printing") && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-60 ${color}`} />
      )}
      <span className={`relative inline-flex h-2 w-2 rounded-full ${color}`} />
    </span>
  );
}

function phaseCopy(c: Clock): string {
  switch (c.phase) {
    case "open":
      return "Bids arrive as ciphertexts and are summed on chain as they land. Nothing is decrypted while the window is open.";
    case "loading":
      return "Reading the chain — the config, the current epoch and its print.";
    case "overdue":
      return "The window ran its length but the keeper has not closed it — the market is paused. Its sealed bids wait; the last print stays verifiable.";
    case "closed":
      return "The accumulators are frozen. The administrator is about to decrypt the per-tick sums with the auditor key and prove each one.";
    case "printing":
      return "Each nonzero tick's sum is published with a proof of correct decryption, four per transaction.";
    case "printed":
      return "The clearing rate is on chain with every sum proven. Matches follow; anyone can re-verify the print from the raw accounts.";
    case "notrade":
      return "Supply and demand did not cross at any tick this window. The regime clock notes it; the next window opens.";
    default:
      return "The keeper opens the next window shortly. The last print stays verifiable meanwhile.";
  }
}

/** A slot distance as a live mm:ss, ticking once a second from the last poll, at the measured slot rate. */
import { useEffect, useState } from "react";
import { slotSeconds, slotsToSecs } from "../lib/slotTime";

export function slotsToClock(slots: number): string {
  const s = slotsToSecs(slots);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
    : `${m}:${String(sec).padStart(2, "0")}`;
}

export function Countdown({ slots, label, className = "" }: { slots: number; label?: string; className?: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    const id = setInterval(() => setElapsed((e) => e + 1), 1_000);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, slots - elapsed / slotSeconds());
  return (
    <span className={`num inline-flex items-baseline gap-1 ${className}`} title={`${Math.round(slots)} slots`}>
      <span className="font-medium text-ink-1">{slotsToClock(remaining)}</span>
      {label && <span className="text-xs text-ink-3">{label}</span>}
    </span>
  );
}

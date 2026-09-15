import { Badge } from "../../components/ui";
import type { StepReport } from "../../lib/send";

export function StepList({ steps }: { steps: StepReport[] }) {
  if (steps.length === 0) return null;
  return (
    <ol className="mt-3 space-y-1 text-xs">
      {steps.map((s) => (
        <li key={s.index} className="flex items-center gap-2">
          <Badge tone={s.state === "confirmed" ? "good" : s.state === "failed" ? "bad" : "mute"}>{s.state}</Badge>
          <span>{s.label}</span>
          {s.signature && <span className="font-mono text-mute">{s.signature.slice(0, 12)}…</span>}
          {s.error && <span className="text-bad">{s.error}</span>}
        </li>
      ))}
    </ol>
  );
}

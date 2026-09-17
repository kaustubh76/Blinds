/** The last program events that arrived over the WebSocket — the chain talking, decoded live. */
import { config } from "../config";
import { formatSlotAge } from "../lib/format";
import { useSlot } from "../lib/queries";
import { useLiveEvents } from "../lib/useLive";
import { Card } from "./Card";
import { Badge, ExplorerLink } from "./ui";

function summarize(data: unknown): string {
  if (!data || typeof data !== "object") return "";
  return Object.entries(data as Record<string, unknown>)
    .filter(([k]) => k !== "discriminator")
    .slice(0, 4)
    .map(
      ([k, v]) =>
        `${k} ${typeof v === "bigint" ? v.toString() : typeof v === "string" && v.length > 12 ? `${v.slice(0, 4)}…` : String(v)}`,
    )
    .join(" · ");
}

export function LiveEvents({ limit = 6 }: { limit?: number }) {
  const live = useLiveEvents();
  const slot = useSlot();
  const shown = live.events.slice(-limit).reverse();
  return (
    <Card
      eyebrow="program events · live"
      title={
        <span className="flex items-center gap-2">
          <span
            className={`inline-block h-2 w-2 rounded-full ${live.connected ? "bg-status-good" : live.enabled ? "bg-status-warning" : "bg-ink-3"}`}
            aria-hidden="true"
          />
          {live.connected ? "subscribed over WebSocket" : live.enabled ? "connecting…" : "real-time off (Settings)"}
        </span>
      }
      footer="Anchor events decoded from the programs' logs as they land; the same lines are in the console (`)."
    >
      {shown.length === 0 ? (
        <p className="text-xs text-ink-3">
          No events yet — they appear the moment the keeper, a member or the operator acts.
        </p>
      ) : (
        <ul className="grid gap-1.5">
          {shown.map((e) => (
            <li key={`${e.signature}-${e.name}`} className="flex flex-wrap items-center gap-2 text-xs">
              <Badge tone={e.program === "auction" ? "lend" : e.program === "oracle" ? "accent" : "borrow"}>
                {e.program}
              </Badge>
              <span className="font-medium text-ink-1">{e.name}</span>
              <span className="mono min-w-0 flex-1 truncate text-ink-3">{summarize(e.data)}</span>
              {slot.data !== undefined && (
                <span className="text-ink-3">{formatSlotAge(Math.max(0, slot.data - e.slot))} ago</span>
              )}
              <ExplorerLink address={e.signature} cluster={config.cluster} kind="tx" />
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

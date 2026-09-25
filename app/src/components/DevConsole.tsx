/**
 * The developer console: every SDK call the page made (as copyable code), every transaction it
 * sent (with an on-demand inspector: logs, compute units, programs), every phase change of the
 * window and every program event that arrived over the WebSocket. Toggle with ` (backtick).
 */
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { config } from "../config";
import { rpc } from "../lib/chain";
import { devConsole, type Entry, type EntryKind, jsonSafe, useConsole, useConsoleOpen } from "../lib/console";
import { shortAddr } from "../lib/format";
import { Icon } from "./Icon";
import { Badge, Button, ExplorerLink, type Tone } from "./ui";

const KINDS: EntryKind[] = ["call", "tx", "chain", "event", "note"];
const KIND_TONE: Record<EntryKind, Tone> = { call: "accent", tx: "mute", chain: "lend", event: "borrow", note: "mute" };

function time(at: number): string {
  const d = new Date(at);
  return `${d.getHours().toString().padStart(2, "0")}:${d.getMinutes().toString().padStart(2, "0")}:${d
    .getSeconds()
    .toString()
    .padStart(2, "0")}`;
}

export function CopyButton({ text, label = "copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={done ? "check" : "copy"}
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        });
      }}
    >
      {done ? "copied" : label}
    </Button>
  );
}

/** Lazily fetched transaction internals — a developer's view of what the chain executed. */
function TxInspector({ signature }: { signature: string }) {
  const q = useQuery({
    queryKey: ["tx", signature],
    queryFn: async () => {
      const r = await rpc
        .getTransaction(signature as never, {
          encoding: "json",
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        })
        .send();
      if (!r) return null;
      const keys = r.transaction.message.accountKeys as readonly string[];
      const programs = Array.from(
        new Set(r.transaction.message.instructions.map((ix) => keys[ix.programIdIndex] ?? "?")),
      );
      return {
        slot: Number(r.slot),
        cu: r.meta?.computeUnitsConsumed !== undefined ? Number(r.meta.computeUnitsConsumed) : null,
        fee: r.meta?.fee !== undefined ? Number(r.meta.fee) : null,
        err: r.meta?.err ? JSON.stringify(r.meta.err) : null,
        logs: r.meta?.logMessages ?? [],
        programs,
      };
    },
    staleTime: Number.POSITIVE_INFINITY,
  });
  if (q.isLoading) return <p className="text-xs text-ink-3">fetching the transaction…</p>;
  if (!q.data) return <p className="text-xs text-ink-3">not available from this RPC (yet)</p>;
  return (
    <div className="grid gap-2 text-xs">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-ink-2">
        <span>slot {q.data.slot}</span>
        {q.data.cu !== null && <span>{q.data.cu.toLocaleString("en-US")} CU</span>}
        {q.data.fee !== null && <span>fee {q.data.fee} lamports</span>}
        {q.data.err && <span className="text-status-critical">err {q.data.err}</span>}
      </div>
      <div className="flex flex-wrap gap-1">
        {q.data.programs.map((p) => (
          <ExplorerLink key={p} address={p} cluster={config.cluster} />
        ))}
      </div>
      <pre className="mono max-h-56 overflow-auto rounded-[var(--radius-sm)] border border-line bg-surface-0 p-2 text-[11px] leading-relaxed text-ink-2">
        {q.data.logs.join("\n")}
      </pre>
    </div>
  );
}

function Row({ e }: { e: Entry }) {
  const [open, setOpen] = useState(false);
  const stateTone: Tone = e.state === "confirmed" ? "good" : e.state === "failed" ? "bad" : "warn";
  const copyText =
    e.code ?? jsonSafe({ title: e.title, signature: e.signature, programs: e.programs, detail: e.detail });
  return (
    <li className="border-b border-line/60 last:border-0">
      <div className="flex flex-wrap items-center gap-2 px-3 py-1.5 text-xs">
        <span className="mono text-ink-3">{time(e.at)}</span>
        <Badge tone={KIND_TONE[e.kind]}>{e.kind}</Badge>
        <button
          type="button"
          className="min-w-0 flex-1 truncate text-left text-ink-1 hover:text-accent"
          onClick={() => setOpen((o) => !o)}
          title={e.title}
        >
          {e.title}
        </button>
        {e.state && (
          <Badge tone={stateTone} icon={e.state === "confirmed" ? "check" : e.state === "failed" ? "x" : "clock"}>
            {e.state}
          </Badge>
        )}
        {e.signature && <ExplorerLink address={e.signature} cluster={config.cluster} kind="tx" />}
        {e.programs && e.programs.length > 0 && (
          <span className="mono hidden text-ink-3 md:inline" title={e.programs.join("\n")}>
            {e.programs.map((p) => shortAddr(p, 3)).join(" ")}
          </span>
        )}
        <CopyButton text={copyText} />
      </div>
      {e.error && <p className="px-3 pb-2 text-xs text-status-critical">{e.error}</p>}
      {open && (
        <div className="grid gap-2 px-3 pb-3">
          {e.code && (
            <pre className="mono overflow-auto rounded-[var(--radius-sm)] border border-line bg-surface-0 p-2 text-[11px] leading-relaxed text-ink-1">
              {e.code}
            </pre>
          )}
          {e.detail !== undefined && (
            <pre className="mono max-h-40 overflow-auto rounded-[var(--radius-sm)] border border-line bg-surface-0 p-2 text-[11px] leading-relaxed text-ink-2">
              {typeof e.detail === "string" ? e.detail : jsonSafe(e.detail)}
            </pre>
          )}
          {e.kind === "tx" && e.signature && <TxInspector signature={e.signature} />}
        </div>
      )}
    </li>
  );
}

export function DevConsole() {
  const entries = useConsole();
  const [open, setOpen] = useConsoleOpen();
  const [filter, setFilter] = useState<EntryKind | "all">("all");
  if (!open) return null;
  const shown = (filter === "all" ? entries : entries.filter((e) => e.kind === filter)).slice(-200).reverse();
  return (
    <section
      className="fixed inset-x-0 bottom-[calc(3.5rem+env(safe-area-inset-bottom))] z-30 flex h-[42vh] min-h-[220px] flex-col border-t border-line bg-surface-1/95 backdrop-blur lg:bottom-0"
      aria-label="developer console"
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-1.5">
        <Icon name="terminal" size={14} className="text-accent" />
        <span className="text-sm font-medium">Console</span>
        <span className="mono text-[11px] text-ink-3">{entries.length} entries</span>
        <div className="ml-2 flex gap-1">
          {(["all", ...KINDS] as const).map((k) => (
            <button
              type="button"
              key={k}
              onClick={() => setFilter(k)}
              className={`rounded-[var(--radius-sm)] px-2 py-0.5 text-[11px] ${
                filter === k ? "bg-surface-2 text-ink-1" : "text-ink-3 hover:text-ink-1"
              }`}
            >
              {k}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <CopyButton text={jsonSafe(entries)} label="copy all" />
          <Button variant="ghost" size="sm" onClick={() => devConsole.clear()}>
            clear
          </Button>
          <Button variant="ghost" size="sm" icon="x" onClick={() => setOpen(false)} title="close (`)">
            <span className="sr-only">close</span>
          </Button>
        </div>
      </div>
      {shown.length === 0 ? (
        <p className="px-3 py-3 text-xs text-ink-3">
          Nothing yet — every call, transaction and event lands here with the code that reproduces it.
        </p>
      ) : (
        <ul className="min-h-0 flex-1 overflow-y-auto">
          {shown.map((e) => (
            <Row key={e.id} e={e} />
          ))}
        </ul>
      )}
    </section>
  );
}

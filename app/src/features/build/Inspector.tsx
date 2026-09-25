/**
 * What actually went over the wire.
 *
 * The recipe cards show what the SDK returned; this shows the JSON-RPC underneath — including the calls
 * made *inside* the SDK, which is the interesting part. `verifyPrint` looks like one function and is a
 * hundred `getTransaction`s; a developer budgeting against a rate-limited endpoint needs to see that.
 *
 * Each call renders as the `curl` that reproduces it, so it can be taken out of the browser entirely.
 */
import { useState } from "react";
import { CopyButton } from "../../components/DevConsole";
import { Badge, Button, Note } from "../../components/ui";
import { MAX_BODY, type RpcCall, rpcTap } from "../../lib/rpcTap";

function body(v: unknown): string {
  let text: string;
  try {
    text = JSON.stringify(v, (_k, x) => (typeof x === "bigint" ? `${x}n` : x), 1) ?? String(v);
  } catch (e) {
    // A response that cannot be rendered is a line of text, never a thrown render: this panel sits
    // inside the page it is describing, and an error boundary would take the whole page with it.
    text = `<could not be rendered: ${e instanceof Error ? e.message : String(e)}>`;
  }
  return text.length > MAX_BODY ? `${text.slice(0, MAX_BODY)}\n… ${text.length - MAX_BODY} more characters` : text;
}

/** Never let a request we cannot render stop the page from rendering. */
function curl(c: RpcCall): string {
  try {
    return rpcTap.asCurl(c);
  } catch (e) {
    return `# ${c.method}: could not be rendered (${e instanceof Error ? e.message : String(e)})`;
  }
}

export function Inspector({ calls }: { calls: readonly RpcCall[] }) {
  const [openId, setOpenId] = useState<number | null>(null);
  if (calls.length === 0) return null;
  const total = calls.reduce((n, c) => n + c.ms, 0);
  const bytes = calls.reduce((n, c) => n + c.bytes, 0);
  // Several calls of the same method is the normal case, and the count is the point.
  const byMethod = new Map<string, number>();
  for (const c of calls) byMethod.set(c.method, (byMethod.get(c.method) ?? 0) + 1);
  return (
    <div className="mt-3 grid gap-2 rounded-[var(--radius-md)] border border-line bg-surface-2 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="mono text-[11px] uppercase tracking-[0.14em] text-ink-3">over the wire</span>
        <Badge>
          {calls.length} call{calls.length === 1 ? "" : "s"}
        </Badge>
        <Badge>{total} ms of RPC</Badge>
        <Badge>{(bytes / 1024).toFixed(1)} KiB back</Badge>
        {calls.some((c) => !c.ok) && <Badge tone="bad">{calls.filter((c) => !c.ok).length} failed</Badge>}
        <span className="ml-auto">
          <CopyButton label="copy all as curl" text={calls.map(curl).join("\n\n")} />
        </span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {[...byMethod.entries()]
          .sort((a, b) => b[1] - a[1])
          .map(([m, n]) => (
            <Badge key={m} tone="mute">
              {m} ×{n}
            </Badge>
          ))}
      </div>
      <ul className="grid gap-1">
        {calls.map((c) => (
          <li key={c.id} className="rounded-[var(--radius-sm)] border border-line bg-surface-1">
            <button
              type="button"
              onClick={() => setOpenId(openId === c.id ? null : c.id)}
              aria-expanded={openId === c.id}
              className="flex w-full flex-wrap items-center gap-2 px-2 py-1.5 text-left text-[11px]"
            >
              <span className="mono text-ink-3">#{c.id}</span>
              <span className="mono text-ink-1">{c.method}</span>
              <span className="text-ink-3">{c.ms} ms</span>
              {c.bytes > 0 && <span className="text-ink-3">{(c.bytes / 1024).toFixed(1)} KiB</span>}
              {!c.ok && <Badge tone="bad">failed</Badge>}
              <span className="ml-auto text-accent">{openId === c.id ? "hide" : "request / response"}</span>
            </button>
            {openId === c.id && (
              <div className="grid gap-2 border-t border-line px-2 py-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="mono text-[10px] uppercase tracking-[0.14em] text-ink-3">request</span>
                  <CopyButton label="copy as curl" text={curl(c)} />
                </div>
                <pre className="mono max-h-40 overflow-auto rounded-[var(--radius-sm)] bg-surface-0 px-2 py-1 text-[10.5px] leading-relaxed text-ink-2">
                  {curl(c)}
                </pre>
                <span className="mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
                  {c.ok ? "response" : "error"}
                </span>
                <pre className="mono max-h-56 overflow-auto rounded-[var(--radius-sm)] bg-surface-0 px-2 py-1 text-[10.5px] leading-relaxed text-ink-2">
                  {c.ok ? body(c.response) : (c.error ?? "—")}
                </pre>
              </div>
            )}
          </li>
        ))}
      </ul>
      {calls.length >= 200 && (
        <Note tone="warn">Only the last 200 calls are kept; a longer run made more than this shows.</Note>
      )}
      <Note>
        These are the calls the app made, which is not the same as the requests that left the browser: the transport
        coalesces identical calls in the same tick into one. What you see is what the SDK asked for.
      </Note>
    </div>
  );
}

/** The toggle on the recipe card. Recording costs a timestamp per call, and only while it is on. */
export function InspectorToggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <Button
      variant="ghost"
      size="sm"
      icon={on ? "eye" : "eyeOff"}
      onClick={() => onChange(!on)}
      title="record the JSON-RPC this recipe makes"
    >
      {on ? "wire on" : "wire"}
    </Button>
  );
}

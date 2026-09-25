/**
 * A button that runs one of this repo's own commands, when there is a machine to run it on.
 *
 * With the dev server in front of you, the command runs and its output streams into the row and into
 * the ` console. On the hosted site there is no bridge — the plugin is dev-only — so the same row
 * shows the exact line to type, with a copy button. The difference is stated, not hidden: a control
 * that cannot work is worse than a command you can read.
 *
 * Anything that spends money needs two clicks and an explicit opt-in on the dev server
 * (`WINDOW_DEV_BRIDGE_ALLOW_SPEND=1`), and says which cluster's money it is before you confirm.
 */
import { useRef, useState } from "react";
import { type BridgeCommand, bridgeCommand, COMMAND_TEXT, runBridge, useBridge } from "../lib/devBridge";
import { CopyButton } from "./DevConsole";
import { Badge, Button, Note } from "./ui";

/** How many lines of a running command are kept on screen. The console keeps all of them. */
const TAIL = 14;

export function BridgeRun({ ids }: { ids: readonly string[] }) {
  const { state, info } = useBridge();
  if (ids.length === 0) return null;
  return (
    <div className="grid gap-2">
      {ids.map((id) => (
        <Row key={id} id={id} live={state === "present" ? bridgeCommand(info, id) : null} spendFlag={info?.spendFlag} />
      ))}
      {state === "absent" && (
        <Note>
          These run on a machine with the repo checked out. This page is served as static files, so it has no way to
          start a process — copy the line instead.
        </Note>
      )}
    </div>
  );
}

function Row({ id, live, spendFlag }: { id: string; live: BridgeCommand | null; spendFlag?: string | undefined }) {
  const text = COMMAND_TEXT[id];
  const [args, setArgs] = useState<Record<string, string>>({});
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [armed, setArmed] = useState(false);
  const [outcome, setOutcome] = useState<{ ok: boolean; message: string } | null>(null);
  const abort = useRef<AbortController | null>(null);
  if (!text) return null;

  const spends = live?.spends ?? text.spends;
  const params = live?.params ?? {};
  const command = live?.command ?? text.command;
  const blockedBySpend = !!live && !live.runnable;
  const missing = live?.missing ?? [];

  const go = () => {
    if (spends && !armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    setLines([]);
    setOutcome(null);
    setRunning(true);
    const ac = new AbortController();
    abort.current = ac;
    runBridge(
      id,
      args,
      (l) => {
        if (l.line !== undefined) setLines((prev) => [...prev.slice(-(TAIL - 1)), l.line as string]);
      },
      ac.signal,
    )
      .then((r) =>
        setOutcome(
          r.code === 0 ? { ok: true, message: "finished" } : { ok: false, message: r.error ?? `exited ${r.code}` },
        ),
      )
      .catch((e: unknown) => setOutcome({ ok: false, message: e instanceof Error ? e.message : String(e) }))
      .finally(() => {
        setRunning(false);
        abort.current = null;
      });
  };

  return (
    <div className="grid gap-2 rounded-[var(--radius-md)] border border-line bg-surface-2 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-medium text-ink-1">{text.label}</span>
        {spends && (
          <Badge tone={spends === "mainnet" ? "bad" : "warn"} icon="alert">
            spends {spends}
          </Badge>
        )}
        {missing.length > 0 && <Badge tone="warn">needs {missing.join(", ")}</Badge>}
        {live?.needsBuild && <Badge tone="warn">not built</Badge>}
        <span className="ml-auto flex items-center gap-2">
          {Object.entries(params).map(([key, spec]) => {
            const fieldId = `bridge-${id}-${key}`;
            return (
              <span key={key} className="flex items-center gap-1 text-[11px] text-ink-3">
                <label htmlFor={fieldId}>{key}</label>
                {spec.kind === "choice" ? (
                  <select
                    id={fieldId}
                    className="rounded-[var(--radius-sm)] border border-line bg-surface-0 px-1.5 py-0.5 text-xs text-ink-1"
                    value={args[key] ?? String(spec.default)}
                    onChange={(e) => setArgs((p) => ({ ...p, [key]: e.target.value }))}
                  >
                    {(spec.choices ?? []).map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={fieldId}
                    type="number"
                    min={spec.min}
                    max={spec.max}
                    className="w-16 rounded-[var(--radius-sm)] border border-line bg-surface-0 px-1.5 py-0.5 text-xs text-ink-1"
                    value={args[key] ?? String(spec.default)}
                    onChange={(e) => setArgs((p) => ({ ...p, [key]: e.target.value }))}
                  />
                )}
              </span>
            );
          })}
          {running ? (
            <Button size="sm" variant="danger" icon="stop" onClick={() => abort.current?.abort()}>
              stop
            </Button>
          ) : live ? (
            <Button
              size="sm"
              variant={armed ? "danger" : "ghost"}
              icon={armed ? "alert" : "play"}
              disabled={blockedBySpend || missing.length > 0 || !!live.needsBuild}
              onClick={go}
              title={
                blockedBySpend
                  ? `refused: restart the dev server with ${spendFlag ?? "the spend flag"}`
                  : missing.length > 0
                    ? `needs ${missing.join(", ")} in the environment`
                    : (live.needsBuild ?? text.blurb)
              }
            >
              {armed ? `really run · spends ${spends}` : "run"}
            </Button>
          ) : (
            <CopyButton text={command} label="copy" />
          )}
        </span>
      </div>
      <p className="text-[11px] leading-relaxed text-ink-3">{text.blurb}</p>
      <pre className="mono overflow-x-auto rounded-[var(--radius-sm)] bg-surface-0 px-2 py-1 text-[11px] text-ink-2">
        {command}
      </pre>
      {blockedBySpend && (
        <Note tone="warn">
          Refused before it starts: this spends {spends} funds. Restart the dev server with{" "}
          <span className="mono">{spendFlag ?? "WINDOW_DEV_BRIDGE_ALLOW_SPEND=1"}</span> if you mean it.
        </Note>
      )}
      {live?.needsBuild && (
        <Note tone="warn">
          The binary is not built yet: <span className="mono">{live.needsBuild}</span>
        </Note>
      )}
      {lines.length > 0 && (
        <pre className="mono max-h-48 overflow-auto rounded-[var(--radius-sm)] border border-line bg-surface-0 px-2 py-1 text-[11px] leading-relaxed text-ink-2">
          {lines.join("\n")}
        </pre>
      )}
      {outcome && <Note tone={outcome.ok ? "good" : "bad"}>{outcome.message}</Note>}
    </div>
  );
}

/**
 * Runtime settings: where this browser reads the chain, where the admin service (faucet) is, and
 * the burner key. Everything here is per-browser; nothing is sent anywhere but the endpoints named.
 */
import { useRef, useState } from "react";
import { clearSettings, config, saveSettings } from "../config";
import { backdrop, useBackdropEnabled } from "../lib/backdrop";
import { BURNER_WALLET_NAME, burnerAddress, exportBurnerSecretHex, forgetBurner, hasBurner } from "../lib/burner";
import { clearPrefs, readPref, writePref } from "../lib/prefs";
import { useDeployment, useSolBalance } from "../lib/queries";
import { downloadSession, importSession, plural, restoredSummary, sessionFileName } from "../lib/session";
import { useSession } from "../lib/wallet";
import { Icon } from "./Icon";
import { Badge, Button, ExplorerLink, Field, inputCls, Note } from "./ui";

export function SettingsSheet({ onClose }: { onClose: () => void }) {
  const [rpc, setRpc] = useState(config.rpcUrl);
  const [ws, setWs] = useState(config.wsUrl);
  const [admin, setAdmin] = useState(config.adminUrl);
  const [live, setLive] = useState(() => readPref("live", true));
  const motion = useBackdropEnabled();
  const dep = useDeployment();
  const s = useSession();
  const burnerAddr = burnerAddress();
  const sol = useSolBalance(burnerAddr ?? undefined);
  const [secret, setSecret] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const [transfer, setTransfer] = useState<{ tone: "good" | "warn"; says: string } | null>(null);

  const download = () => {
    const file = downloadSession();
    if (!file)
      return setTransfer({ tone: "warn", says: "No burner in this browser yet, so there is nothing to carry." });
    setTransfer({
      tone: "good",
      says: `${sessionFileName(file)} — the key and ${plural(file.bids.length, "bid record")}.`,
    });
  };
  const restore = async (picked: File | undefined) => {
    if (!picked) return;
    try {
      const r = await importSession(await picked.text());
      setTransfer({ tone: r.unreadable > 0 || !r.clusterMatches ? "warn" : "good", says: restoredSummary(r) });
      setSecret(null);
      if (r.keyRestored && s.wallet?.name === BURNER_WALLET_NAME) await s.disconnect();
    } catch (e) {
      setTransfer({ tone: "warn", says: e instanceof Error ? e.message : "that file could not be read" });
    }
  };

  const save = () => {
    saveSettings({ rpcUrl: rpc.trim(), wsUrl: ws.trim(), adminUrl: admin.trim() });
    writePref("live", live);
    location.reload();
  };
  const reset = () => {
    clearSettings();
    clearPrefs(); // the toggles below are preferences, and "defaults" has to mean them too
    location.reload();
  };
  const src = (k: keyof typeof config.source) => <Badge>{config.source[k]}</Badge>;

  return (
    <div className="fixed inset-0 z-40 flex justify-end">
      <button type="button" aria-label="close settings" className="absolute inset-0 bg-black/50" onClick={onClose} />
      <aside
        className="relative h-full w-full max-w-md overflow-y-auto border-l border-line bg-surface-1 p-5"
        aria-label="settings"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold">Settings</h2>
          <Button variant="ghost" size="sm" onClick={onClose} icon="x">
            close
          </Button>
        </div>
        <p className="mt-1 text-xs text-ink-3">
          Per-browser. A link with <span className="mono">?rpc=</span>, <span className="mono">?ws=</span> or{" "}
          <span className="mono">?admin=</span> sets these once.
        </p>

        <div className="mt-5 grid gap-4">
          <Field label="RPC URL" hint={<span className="flex items-center gap-2">source {src("rpc")}</span>}>
            <input className={inputCls} value={rpc} onChange={(e) => setRpc(e.target.value)} spellCheck={false} />
          </Field>
          <Field
            label="WebSocket URL"
            hint={
              <span className="flex items-center gap-2">source {src("ws")} · derived from the RPC URL unless set</span>
            }
          >
            <input className={inputCls} value={ws} onChange={(e) => setWs(e.target.value)} spellCheck={false} />
          </Field>
          <Field
            label="Admin service URL (faucet)"
            hint={
              <span className="flex flex-wrap items-center gap-2">
                source {src("admin")}
                {dep.data?.faucet ? (
                  <Badge tone="good" icon="check">
                    reachable at {dep.data.adminUrl}
                  </Badge>
                ) : (
                  <Badge tone="warn" icon="alert">
                    not reachable — the Desk's Join is off
                  </Badge>
                )}
              </span>
            }
          >
            <input
              className={inputCls}
              value={admin}
              onChange={(e) => setAdmin(e.target.value)}
              placeholder="https://….trycloudflare.com"
              spellCheck={false}
            />
          </Field>
          <label className="-my-2 flex items-center gap-2 py-2 text-sm">
            <input type="checkbox" data-pref="live" checked={live} onChange={(e) => setLive(e.target.checked)} />
            Real-time: subscribe over WebSocket and decode program events (polling stays on either way)
          </label>
          <label className="-my-2 flex items-center gap-2 py-2 text-sm">
            <input
              type="checkbox"
              data-pref="backdrop"
              checked={motion}
              onChange={(e) => backdrop.setEnabled(e.target.checked)}
            />
            Background motion — the field follows the window. Off when your system asks for reduced motion.
          </label>
          <div className="flex gap-2">
            <Button onClick={save} icon="check">
              Save &amp; reload
            </Button>
            <Button variant="ghost" onClick={reset}>
              Reset to defaults
            </Button>
          </div>
        </div>

        <h3 className="mono mt-8 text-[11px] uppercase tracking-[0.14em] text-ink-3">devnet burner</h3>
        {hasBurner() && burnerAddr ? (
          <div className="mt-2 grid gap-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <Icon name="key" size={14} className="text-accent" />
              <ExplorerLink address={burnerAddr} cluster={config.cluster}>
                {burnerAddr}
              </ExplorerLink>
              {s.wallet?.name === BURNER_WALLET_NAME && <Badge tone="accent">connected</Badge>}
            </div>
            <div className="text-xs text-ink-2">
              {sol.data !== undefined ? `${(Number(sol.data) / 1e9).toFixed(4)} SOL` : "balance …"} · devnet only ·
              anyone using this browser profile can spend it.
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSecret((v) => (v ? null : exportBurnerSecretHex()));
                  setCopied(false);
                }}
              >
                {secret ? "Hide secret" : "Export secret"}
              </Button>
              {secret && (
                <Button
                  variant="ghost"
                  size="sm"
                  icon="copy"
                  onClick={() => navigator.clipboard.writeText(secret).then(() => setCopied(true))}
                >
                  {copied ? "copied" : "copy"}
                </Button>
              )}
              <Button
                variant="danger"
                size="sm"
                onClick={() => {
                  if (!window.confirm("Forget this burner key? Anything it holds on devnet stays with the key."))
                    return;
                  forgetBurner();
                  if (s.wallet?.name === BURNER_WALLET_NAME) void s.disconnect();
                  setSecret(null);
                }}
              >
                Forget
              </Button>
            </div>
            {secret && (
              <div>
                <code className="mono block break-all rounded-[var(--radius-sm)] border border-line bg-surface-0 p-2 text-[11px]">
                  {secret}
                </code>
                <Note tone="warn">32-byte Ed25519 secret, hex. Whoever has it controls the key.</Note>
              </div>
            )}
          </div>
        ) : (
          <Note>No burner yet — the wallet menu creates one.</Note>
        )}

        <h3 className="mono mt-8 text-[11px] uppercase tracking-[0.14em] text-ink-3">carry this session</h3>
        <p className="mt-1 text-xs text-ink-3">
          One file holds the key and every bid record. The openings in it are the only copy, and a lock needs them.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button variant="ghost" size="sm" icon="download" onClick={download} disabled={!hasBurner()}>
            Download
          </Button>
          <Button variant="ghost" size="sm" icon="upload" onClick={() => fileInput.current?.click()}>
            Restore from a file
          </Button>
          <input
            ref={fileInput}
            id="session-file"
            type="file"
            accept="application/json,.json"
            className="sr-only"
            aria-label="session file to restore"
            onChange={(e) => {
              void restore(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </div>
        {transfer && <Note tone={transfer.tone}>{transfer.says}</Note>}
      </aside>
    </div>
  );
}

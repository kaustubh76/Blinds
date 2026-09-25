/**
 * The scratchpad: the recipe's own code, editable, run in this tab.
 *
 * It is **JavaScript**, not TypeScript, and the page says so. Nothing here strips type annotations —
 * there is no compiler in the browser — and the recipes' snippets happen to be valid JS already, so
 * calling it TypeScript would be a small lie for no gain. What it does give you is the real `sdk`, the
 * real `rpc`, and your own signer, against a live market, with a copyable result.
 *
 * The body runs through `new AsyncFunction`, so `await` works at the top level and `return` is how you
 * hand a value back. It is your code in your own tab; the only guard rails are an abort signal and the
 * fact that nothing is persisted anywhere but this browser.
 */
import * as sdk from "@thewindow/solana-sdk";
import { useRef, useState } from "react";
import { CopyButton } from "../../components/DevConsole";
import { Button, Note } from "../../components/ui";
import { config } from "../../config";
import { rpc } from "../../lib/chain";
import { devConsole, jsonSafe } from "../../lib/console";
import { readPrefValue, writePrefValue } from "../../lib/prefs";
import type { Desk } from "./recipes";

const PREF = "scratchpad.body";

/**
 * A recipe's snippet, made runnable: the `import` lines and the `const rpc = …` the prelude sets up are
 * already in scope here, so they go. Everything else is left exactly as the recipe wrote it.
 */
export function runnableFrom(code: string): string {
  return code
    .split("\n")
    .filter((l) => !/^\s*import\s/.test(l) && !/^\s*const\s+rpc\s*=\s*createSolanaRpc/.test(l))
    .join("\n")
    .trim();
}

const AsyncFunction = Object.getPrototypeOf(async () => {}).constructor as new (
  ...args: string[]
) => (...args: unknown[]) => Promise<unknown>;

export function Scratchpad({ seed, desk }: { seed: string; desk: Desk | null }) {
  const [body, setBody] = useState(() => readPrefValue(PREF, ""));
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [lines, setLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const [ms, setMs] = useState<number | null>(null);
  const ctrl = useRef<AbortController | null>(null);

  const load = () => {
    const next = runnableFrom(seed);
    writePrefValue(PREF, next);
    setBody(next);
  };

  const run = async () => {
    const c = new AbortController();
    ctrl.current = c;
    setRunning(true);
    setOut(null);
    setErr(null);
    setLines([]);
    const t0 = performance.now();
    const id = devConsole.push({ kind: "call", title: "scratchpad", code: body, state: "pending" });
    try {
      const log = (...args: unknown[]) => {
        const line = args.map((a) => (typeof a === "string" ? a : jsonSafe(a, 0))).join(" ");
        setLines((l) => [...l.slice(-49), line]);
      };
      // `desk` is the Desk's own flows, which is how anything here signs; there is no bare signer to
      // hand over, because every write in this app goes through a traced mutation rather than raw.
      const fn = new AsyncFunction("sdk", "rpc", "config", "desk", "console", "signal", body);
      const v = await fn(sdk, rpc, config, desk, { log, info: log, warn: log, error: log }, c.signal);
      setOut(v === undefined ? "(returned nothing — `return` a value to see it here)" : jsonSafe(v));
      devConsole.update(id, { state: "confirmed", ...(v === undefined ? {} : { detail: v }) });
    } catch (e) {
      const m = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
      setErr(m);
      devConsole.update(id, { state: "failed", error: m });
    } finally {
      setMs(Math.round(performance.now() - t0));
      setRunning(false);
      ctrl.current = null;
    }
  };

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="ghost" size="sm" icon="code" onClick={load}>
          load the recipe above
        </Button>
        <Button
          variant="ghost"
          size="sm"
          icon="x"
          onClick={() => {
            writePrefValue(PREF, "");
            setBody("");
            setOut(null);
            setErr(null);
            setLines([]);
          }}
        >
          clear
        </Button>
        {ms !== null && !running && <span className="mono text-[11px] text-ink-3">{ms} ms</span>}
        <span className="ml-auto flex items-center gap-1">
          <CopyButton text={body} />
          {running ? (
            <Button variant="ghost" size="sm" icon="stop" onClick={() => ctrl.current?.abort()}>
              abort
            </Button>
          ) : (
            <Button size="sm" icon="play" disabled={!body.trim()} onClick={() => void run()}>
              run here
            </Button>
          )}
        </span>
      </div>
      <textarea
        className="mono min-h-56 w-full resize-y rounded-[var(--radius-md)] border border-line bg-surface-0 p-3 text-[11.5px] leading-relaxed text-ink-1 focus:border-accent focus:outline-none"
        spellCheck={false}
        value={body}
        placeholder={
          "// JavaScript. `sdk`, `rpc`, `config`, `desk`, `signal` are in scope; `await` works here.\nconst cfg = await sdk.fetchAuctionConfig(rpc);\nconsole.log(cfg.currentEpoch, cfg.hasOpenEpoch);\nreturn cfg;"
        }
        onChange={(e) => {
          writePrefValue(PREF, e.target.value);
          setBody(e.target.value);
        }}
        aria-label="scratchpad"
      />
      <Note>
        JavaScript, not TypeScript — nothing in the tab strips type annotations, and the recipes' code happens to be
        valid JS as written. In scope: <span className="mono">sdk</span>, <span className="mono">rpc</span>,{" "}
        <span className="mono">config</span>, <span className="mono">desk</span> (
        {desk ? "your connected wallet's flows" : "null until a wallet is connected"}),{" "}
        <span className="mono">console.log</span> and <span className="mono">signal</span>.{" "}
        <span className="mono">return</span> a value to see it below.
      </Note>
      {lines.length > 0 && (
        <pre className="mono max-h-40 overflow-auto rounded-[var(--radius-md)] border border-line bg-surface-0 p-3 text-[11px] leading-relaxed text-ink-3">
          {lines.join("\n")}
        </pre>
      )}
      {err && <p className="text-xs text-status-critical">{err}</p>}
      {out && (
        <pre className="mono max-h-72 overflow-auto rounded-[var(--radius-md)] border border-line bg-surface-0 p-3 text-[11px] leading-relaxed text-ink-2">
          {out}
        </pre>
      )}
    </div>
  );
}

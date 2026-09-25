/**
 * The page's side of the dev bridge (`app/vite/devBridge.mjs`): the catalogue of commands this
 * checkout can run, and a streaming runner.
 *
 * The bridge is a dev-server plugin, so a built page can never have one. That is not a failure and
 * is not probed for: `import.meta.env.PROD` settles it without a request, and every caller renders
 * the command as text with a copy button instead. A visitor to the hosted site sees what to type;
 * someone with the repo checked out gets a button.
 */
import { useEffect, useState } from "react";
import { devConsole } from "./console";

export interface BridgeParamSpec {
  kind: "int" | "choice";
  min?: number;
  max?: number;
  choices?: string[];
  default: string | number;
}

export interface BridgeCommand {
  id: string;
  label: string;
  blurb: string;
  /** Present when running it costs money on that cluster; such a command needs the spend flag. */
  spends?: "localnet" | "devnet" | "mainnet";
  params: Record<string, BridgeParamSpec>;
  /** The same command as a line you could type yourself — shown when there is no bridge. */
  command: string;
  /** False when it spends and the dev server was not started with the spend flag. */
  runnable: boolean;
  /** Environment names it needs and cannot find (e.g. `CLAWPUMP_API_KEY`). */
  missing: string[];
  /** Set when the command's binary is not built yet; the value is the build command. */
  needsBuild?: string;
}

export interface BridgeInfo {
  root: string;
  spendAllowed: boolean;
  spendFlag: string;
  commands: BridgeCommand[];
}

/**
 * The same commands as text, for a page with no bridge — the hosted site, where a button could not
 * work and a copyable line can. It is a second copy of `app/vite/devBridge.mjs`'s table on purpose:
 * that file is a dev-server plugin and is not in a build. `devBridge.test.ts` asserts the two agree,
 * so the copy cannot drift without a test failing.
 */
export const COMMAND_TEXT: Record<string, { label: string; blurb: string; command: string; spends?: string }> = {
  "launch-plan": {
    label: "Price the curve",
    blurb:
      "Reads Pyth for the quote stock and writes the launch plan. On devnet it also creates the twin quote mint it needs.",
    command: "pnpm --filter @thewindow/launch plan",
    spends: "devnet",
  },
  "launch-status": {
    label: "Read the pool",
    blurb: "Progress, raised against the threshold, spot and the fees accrued to the agent.",
    command: "pnpm --filter @thewindow/launch status",
  },
  "launch-preflight": {
    label: "Preflight the launch",
    blurb: "Every check the launch makes — balance, quote age, config — and sends nothing.",
    command: "pnpm --filter @thewindow/launch launch -- --dry-run",
  },
  "launch-buy": {
    label: "Buy into the curve",
    blurb: "Swaps quote units into the pool's token, which moves the curve and the fee period.",
    command: "pnpm --filter @thewindow/launch buy -- 5",
    spends: "devnet",
  },
  "launch-create": {
    label: "Create the pool",
    blurb: "createConfigAndPool: the pool mints its token. About 0.03 SOL plus rents.",
    command: "pnpm --filter @thewindow/launch launch",
    spends: "devnet",
  },
  "launch-graduate": {
    label: "Graduate",
    blurb: "Metadata, then migrate to DAMM v2 with the LP locked for good.",
    command: "pnpm --filter @thewindow/launch graduate",
    spends: "devnet",
  },
  "agent-status": {
    label: "What Clawpump reports",
    blurb: "Reads the agent back from Clawpump: name, status, wallet, whether it is public.",
    command: "pnpm --filter @thewindow/launch agent-status",
  },
  "agent-upsert": {
    label: "Give the agent its identity",
    blurb:
      "Renames the key's live Clawpump agent, sets its avatar, makes it public and starts it — changes on their side.",
    command: "pnpm --filter @thewindow/launch agent",
  },
  "clawpump-preflight": {
    label: "Preflight the identity coin",
    blurb: "Checks the pair is listed and the agent wallet is funded. Launches nothing.",
    command: "pnpm --filter @thewindow/launch clawpump-launch -- --preflight",
  },
  "clawpump-launch": {
    label: "Launch the identity coin",
    blurb: "Clawpump launches the coin on pump.fun paired with TSLAx. The agent's own wallet pays ~0.0092 SOL.",
    command: "pnpm --filter @thewindow/launch clawpump-launch",
    spends: "mainnet",
  },
  "admin-price-check": {
    label: "What the chain would accept",
    blurb: "Per listing: the mark on chain, its age, and whether lock & seize would be accepted right now.",
    command: "./target/release/window-admin --cluster localnet --profile demo price-check",
  },
  "admin-zk-probe": {
    label: "Probe the ZK program",
    blurb: "Asks the ZK ElGamal proof program to verify one proof of each kind this desk relies on.",
    command: "./target/release/window-admin --cluster localnet --profile demo zk-probe",
  },
  "admin-listings-sync": {
    label: "Sync the collateral schedule",
    blurb: "Pushes config/demo.toml's listings on chain: adds what is missing, updates what changed.",
    command: "./target/release/window-admin --cluster localnet --profile demo listings-sync",
    spends: "localnet",
  },
};

export type BridgeState = "probing" | "present" | "absent";

let state: BridgeState = import.meta.env.PROD ? "absent" : "probing";
let info: BridgeInfo | null = null;
let probeStarted = false;
const listeners = new Set<() => void>();

function settle(s: BridgeState, i: BridgeInfo | null) {
  state = s;
  info = i;
  for (const l of listeners) l();
}

async function probe(): Promise<void> {
  if (import.meta.env.PROD) return;
  try {
    const res = await fetch("/__dev/bridge", { signal: AbortSignal.timeout(2_000) });
    if (!res.ok) return settle("absent", null);
    const body = (await res.json()) as BridgeInfo & { ok?: boolean };
    settle("present", body);
  } catch {
    settle("absent", null);
  }
}

/** The catalogue, probed once per page load. `absent` on any built page, with no request made. */
export function useBridge(): { state: BridgeState; info: BridgeInfo | null } {
  const [, bump] = useState(0);
  useEffect(() => {
    const cb = () => bump((n) => n + 1);
    listeners.add(cb);
    if (state === "probing" && !probeStarted) {
      probeStarted = true;
      void probe();
    }
    return () => {
      listeners.delete(cb);
    };
  }, []);
  return { state, info };
}

/** One command's find, by id. */
export function bridgeCommand(i: BridgeInfo | null, id: string): BridgeCommand | null {
  return i?.commands.find((c) => c.id === id) ?? null;
}

export interface BridgeLine {
  stream: "start" | "out" | "err" | "exit";
  line?: string;
  code?: number;
  command?: string;
  error?: string;
}

export interface BridgeResult {
  code: number;
  lines: string[];
  error?: string;
}

/**
 * Runs one command and calls `onLine` for every line as it arrives. The whole run is one entry in
 * the developer console, so the ` panel reads as a single timeline of transactions this tab sent and
 * commands this machine ran.
 */
export async function runBridge(
  id: string,
  args: Record<string, string | number> = {},
  onLine?: (l: BridgeLine) => void,
  signal?: AbortSignal,
): Promise<BridgeResult> {
  const entry = devConsole.push({ kind: "call", title: `bridge: ${id}`, state: "pending" });
  const lines: string[] = [];
  const fail = (error: string): BridgeResult => {
    devConsole.update(entry, { state: "failed", error, ...(lines.length ? { detail: lines } : {}) });
    return { code: -1, lines, error };
  };
  let res: Response;
  try {
    res = await fetch("/__dev/run", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, args }),
      ...(signal ? { signal } : {}),
    });
  } catch (e) {
    return fail(e instanceof Error ? e.message : String(e));
  }
  if (!res.ok || !res.body) {
    const text = await res.text().catch(() => "");
    let msg = text;
    try {
      msg = (JSON.parse(text) as { error?: string }).error ?? text;
    } catch {
      // a non-JSON body is the message
    }
    return fail(msg || `bridge answered ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let code = -1;
  let error: string | undefined;
  const handle = (raw: string) => {
    if (!raw.trim()) return;
    let l: BridgeLine;
    try {
      l = JSON.parse(raw) as BridgeLine;
    } catch {
      return;
    }
    if (l.stream === "start" && l.command) {
      devConsole.update(entry, { title: `bridge: ${l.command}` });
    } else if (l.stream === "exit") {
      code = l.code ?? -1;
      if (l.error) error = l.error;
    } else if (l.line !== undefined) {
      lines.push(l.line);
    }
    onLine?.(l);
  };
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const parts = buf.split("\n");
    buf = parts.pop() ?? "";
    for (const p of parts) handle(p);
  }
  if (buf) handle(buf);

  devConsole.update(entry, {
    state: code === 0 ? "confirmed" : "failed",
    detail: lines,
    ...(error ? { error } : code === 0 ? {} : { error: `exit ${code}` }),
  });
  return { code, lines, ...(error ? { error } : {}) };
}

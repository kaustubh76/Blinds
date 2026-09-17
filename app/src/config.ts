/**
 * Configuration, resolved once at module load — synchronously, because the RPC client is built from
 * it before React mounts.
 *
 * Precedence, highest first:
 *   1. URL parameters `?rpc=` `?admin=` `?ws=` — persisted to this browser's storage and then
 *      stripped from the address bar (the hash route is kept), so a shared link keeps working after
 *      the page reloads.
 *   2. Settings saved in this browser (the Settings sheet).
 *   3. `VITE_*` values baked in at build time (`.env`, see `.env.example`).
 *   4. Hosted defaults: a production build with nothing set points at devnet, not at a localhost
 *      validator that does not exist where it is served. A dev build with nothing set is local.
 */

export type Cluster = "localnet" | "devnet";
export type Source = "url" | "saved" | "env" | "default";

export interface Settings {
  rpcUrl?: string;
  adminUrl?: string;
  wsUrl?: string;
}

export interface Resolved {
  rpcUrl: string;
  adminUrl: string;
  wsUrl: string;
  cluster: Cluster;
  source: { rpc: Source; admin: Source; ws: Source };
}

export const SETTINGS_KEY = "thewindow:settings";

/** The WebSocket endpoint a JSON-RPC URL implies: same host, `ws(s)`; a local validator's is on 8900. */
export function wsUrlFor(rpcUrl: string): string {
  try {
    const u = new URL(rpcUrl);
    u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
    if (u.port === "8899") u.port = "8900";
    return u.toString().replace(/\/$/, "");
  } catch {
    return rpcUrl.replace(/^http/, "ws");
  }
}

/** Pure resolution, so the precedence is testable without a window. */
export function resolveSettings(input: {
  search: string;
  saved: Settings;
  env: {
    rpcUrl?: string | undefined;
    adminUrl?: string | undefined;
    wsUrl?: string | undefined;
    cluster?: string | undefined;
  };
  hosted: boolean;
}): Resolved & { fromUrl: Settings } {
  const params = new URLSearchParams(input.search);
  const clean = (v: string | null | undefined): string | undefined => {
    const t = v?.trim();
    return t ? t.replace(/\/+$/, "") : undefined;
  };
  const fromUrl: Settings = {};
  const rpcP = clean(params.get("rpc"));
  // `?admin=` with nothing after it is a deliberate "no admin service".
  const adminP = params.has("admin") ? (clean(params.get("admin")) ?? "") : undefined;
  const wsP = clean(params.get("ws"));
  if (rpcP) fromUrl.rpcUrl = rpcP;
  if (adminP !== undefined) fromUrl.adminUrl = adminP;
  if (wsP) fromUrl.wsUrl = wsP;

  const cluster: Cluster =
    input.env.cluster === "devnet" || (input.hosted && !input.env.cluster) ? "devnet" : "localnet";
  const pick = (
    url: string | undefined,
    saved: string | undefined,
    env: string | undefined,
    dflt: string,
  ): [string, Source] => {
    if (url !== undefined) return [url, "url"];
    if (saved !== undefined) return [saved, "saved"];
    if (env !== undefined) return [env, "env"];
    return [dflt, "default"];
  };
  const [rpcUrl, rpcSrc] = pick(
    fromUrl.rpcUrl,
    clean(input.saved.rpcUrl),
    clean(input.env.rpcUrl),
    input.hosted ? "https://api.devnet.solana.com" : "http://127.0.0.1:8899",
  );
  // `?admin=` with an empty value is a deliberate "no admin service"; a saved empty string too.
  const [adminUrl, adminSrc] = pick(
    fromUrl.adminUrl,
    input.saved.adminUrl?.trim() === "" ? "" : clean(input.saved.adminUrl),
    input.env.adminUrl,
    input.hosted ? "" : "http://127.0.0.1:9090",
  );
  const [wsUrl, wsSrc] = pick(fromUrl.wsUrl, clean(input.saved.wsUrl), clean(input.env.wsUrl), wsUrlFor(rpcUrl));
  return { rpcUrl, adminUrl, wsUrl, cluster, source: { rpc: rpcSrc, admin: adminSrc, ws: wsSrc }, fromUrl };
}

function readSaved(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    return raw ? (JSON.parse(raw) as Settings) : {};
  } catch {
    return {};
  }
}

export function saveSettings(patch: Settings): void {
  try {
    const next = { ...readSaved(), ...patch };
    for (const k of Object.keys(next) as Array<keyof Settings>) if (next[k] === undefined) delete next[k];
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable (private window): settings live for this page load only
  }
}

export function clearSettings(): void {
  try {
    localStorage.removeItem(SETTINGS_KEY);
  } catch {
    // ignore
  }
}

const hosted = import.meta.env.PROD;
const inBrowser = typeof window !== "undefined" && typeof window.location !== "undefined";

const resolved = resolveSettings({
  search: inBrowser ? window.location.search : "",
  saved: inBrowser ? readSaved() : {},
  env: {
    rpcUrl: import.meta.env.VITE_RPC_URL,
    adminUrl: import.meta.env.VITE_ADMIN_URL,
    wsUrl: import.meta.env.VITE_WS_URL,
    cluster: import.meta.env.VITE_CLUSTER,
  },
  hosted,
});

// A link with `?admin=…` (or `?rpc=`) configures this browser once, then the address bar is cleaned.
if (inBrowser && Object.keys(resolved.fromUrl).length > 0) {
  saveSettings(resolved.fromUrl);
  try {
    const u = new URL(window.location.href);
    for (const k of ["rpc", "admin", "ws"]) u.searchParams.delete(k);
    window.history.replaceState(null, "", `${u.pathname}${u.search}${u.hash}`);
  } catch {
    // ignore
  }
}

export const config: Resolved = resolved;

/** Wallet-standard chain identifier for the configured cluster. */
export const chain: `solana:${string}` = config.cluster === "devnet" ? "solana:devnet" : "solana:localnet";

/** One RPC client and the admin service's deployment descriptor. Everything on-chain is read here. */
import { type Address, address, createSolanaRpc } from "@solana/kit";
import { isTransientRpcError, withRpcRetry } from "@thewindow/solana-sdk";
// Baked in at build time so Market, Explorer and Positions work from the chain alone, with no
// admin service reachable. Only the Desk's faucet (`POST /join`) needs the service to be up.
import bundledDeployment from "../../../deployments/devnet.json";
import { config } from "../config";

export const rpc = createSolanaRpc(config.rpcUrl);
export type Rpc = typeof rpc;

/** `GET /deployment` of the admin service (mirrors `deployments/<cluster>.json`). */
export interface Deployment {
  cluster: string;
  profile: string;
  programs: Record<string, string>;
  mock_mint: string;
  cstock_mint: string;
  decimals: number;
  escrow_account: string;
  feed_id_hex: string;
  auditor_elgamal_pubkey_hex: string;
  agents: Array<{ index: number; wallet: string; mock_account: string; cstock_account: string; role: string }>;
}

export interface DeploymentView {
  raw: Deployment;
  /** Whether an admin service answered — i.e. whether `POST /join` can work right now. */
  faucet: boolean;
  /** The admin service URL that answered, if any (the faucet posts there). */
  adminUrl: string | null;
  mockMint: Address;
  cstockMint: Address;
  escrow: Address;
  feedId: Uint8Array;
  auditorPubkey: Uint8Array;
  decimals: number;
}

export function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(h.slice(2 * i, 2 * i + 2), 16);
  return out;
}

export function bytesToHex(b: ArrayLike<number>): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

function view(raw: Deployment, adminUrl: string | null): DeploymentView {
  return {
    raw,
    faucet: adminUrl !== null,
    adminUrl,
    mockMint: address(raw.mock_mint),
    cstockMint: address(raw.cstock_mint),
    escrow: address(raw.escrow_account),
    feedId: hexToBytes(raw.feed_id_hex),
    auditorPubkey: hexToBytes(raw.auditor_elgamal_pubkey_hex),
    decimals: raw.decimals,
  };
}

/** The admin URL in force for this page load: configured, or discovered from the hosted pointer file. */
let activeAdminUrl: string = config.adminUrl;
export const adminUrl = () => activeAdminUrl;

/**
 * A hosted build ships `admin-url.txt` next to the page (copied from `deployments/admin-url.txt`
 * by the Pages workflow): the public tunnel URL of the admin service while the market runs. The
 * `?admin=` link is the primary path; this file is the fallback for a visitor who arrives without it.
 */
async function hostedAdminUrl(): Promise<string | null> {
  if (!import.meta.env.PROD) return null;
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}admin-url.txt?t=${Date.now()}`, {
      cache: "no-store",
      signal: AbortSignal.timeout(4_000),
    });
    if (!res.ok) return null;
    const line = (await res.text())
      .split("\n")
      .map((l) => l.trim())
      .find((l) => l && !l.startsWith("#"));
    return line?.startsWith("http") ? line.replace(/\/+$/, "") : null;
  } catch {
    return null;
  }
}

async function probe(url: string): Promise<Deployment | null> {
  try {
    const res = await fetch(`${url}/deployment`, { signal: AbortSignal.timeout(4_000) });
    if (res.ok) return (await res.json()) as Deployment;
  } catch {
    // admin service down or unreachable from this browser
  }
  return null;
}

/**
 * The deployment descriptor. Preferred live from the admin service (which also tells us the faucet
 * is up); otherwise the copy committed to the repo, so a judge with only a browser still gets the
 * market, the explorer and their own positions.
 */
export async function fetchDeployment(): Promise<DeploymentView> {
  const candidates = [config.adminUrl];
  const hosted = await hostedAdminUrl();
  if (hosted && hosted !== config.adminUrl) candidates.push(hosted);
  for (const url of candidates) {
    if (!url) continue;
    const raw = await probe(url);
    if (raw) {
      activeAdminUrl = url;
      return view(raw, url);
    }
  }
  const bundled = bundledDeployment as unknown as Deployment;
  if (!bundled?.mock_mint) throw new Error("no deployment: admin service unreachable and no bundled copy");
  return view(bundled, null);
}

export interface JoinResult {
  signature: string | null;
  alreadyMember: boolean;
}

/**
 * `POST /join`: registers the wallet as a member and funds it with mock stock + fee SOL (demo
 * faucet). An existing member gets `already_member` and nothing is minted or sent again.
 */
export async function joinDesk(args: {
  wallet: Address;
  elgamalPubkey: Uint8Array;
  mockAccount: Address;
}): Promise<JoinResult> {
  const res = await fetch(`${activeAdminUrl}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wallet: args.wallet,
      elgamal_pubkey_hex: bytesToHex(args.elgamalPubkey),
      mock_account: args.mockAccount,
    }),
  });
  const text = await res.text();
  let body: { ok?: boolean; signature?: string | null; already_member?: boolean; error?: string } = {};
  try {
    body = JSON.parse(text);
  } catch {
    // an older service answers with the bare signature
  }
  if (!res.ok) throw new Error(body.error ?? text ?? `join failed: ${res.status}`);
  return {
    signature: body.signature ?? (body.ok === undefined && text ? text : null),
    alreadyMember: !!body.already_member,
  };
}

/** Rent for a proof context account of `space` bytes. */
export const rentFor = async (space: number): Promise<bigint> =>
  BigInt(await retry(() => rpc.getMinimumBalanceForRentExemption(BigInt(space)).send()));

/** A read that rides through the public RPC's 429s; use for the reads a mutation makes before it sends. */
export const retry = <T>(f: () => Promise<T>) => withRpcRetry(f, { attempts: 6 });

/** A human line for an error a flow surfaced: the public RPC's rate limit is the common one. */
export function describeError(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (isTransientRpcError(e)) {
    const status = (e as { context?: { statusCode?: number } }).context?.statusCode;
    return status === 429
      ? "the RPC rate-limited this browser (429) — it was retried; try again in a moment, or set a dedicated RPC URL in Settings"
      : `the RPC did not answer (${m.split(";")[0]}) — try again, or set a dedicated RPC URL in Settings`;
  }
  return m.replace(/; Decode this error by running[^\n]*/, "");
}

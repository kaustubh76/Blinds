/** One RPC client and the admin service's deployment descriptor. Everything on-chain is read here. */
import { type Address, address, createSolanaRpc } from "@solana/kit";
import { isTransientRpcError, pda, priceSourceTag, withRpcRetry } from "@thewindow/solana-sdk";
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
  /** The collateral schedule (absent in a descriptor written before it). */
  listings?: RawListing[];
  agents: Array<{
    index: number;
    wallet: string;
    mock_account: string;
    cstock_account: string;
    role: string;
    listing?: number;
  }>;
}

export interface RawListing {
  key: string;
  symbol: string;
  source: string;
  listing: string;
  mock_mint: string;
  cstock_mint: string;
  escrow_account: string;
  feed_id_hex: string;
  decimals: number;
  haircut_bps: number;
  max_price_age_slots: number;
  max_publish_age_secs: number;
  /** `Listing.price_source` on chain; absent in a descriptor written before source 4 (then derived from `source`). */
  price_source?: number;
  /** Source 4: the Pyth receiver-owned account the program reads for this listing. */
  price_account?: string;
}

/** One eligible collateral, as the dashboard addresses it. */
export interface ListingView {
  key: string;
  symbol: string;
  /** `pyth` | `prestocks` | `mock` (`reserved`: a retired source) */
  source: string;
  listing: Address;
  mockMint: Address;
  cstockMint: Address;
  escrow: Address;
  feedId: Uint8Array;
  decimals: number;
  haircutBps: bigint;
  maxPriceAgeSlots: number;
  maxPublishAgeSecs: number;
  /** `Listing.price_source`: 0 Pyth cache · 1 reserved (retired) · 2 PreStocks · 3 mock · 4 Pyth's own account. */
  priceSource: number;
  /** The Pyth account the program reads when `priceSource` is 4; `null` otherwise. */
  priceAccount: Address | null;
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
  /** The collateral schedule; `listings[0]` is the original collateral the legacy fields mirror. */
  listings: ListingView[];
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

function listingView(l: RawListing): ListingView {
  return {
    key: l.key,
    symbol: l.symbol,
    source: l.source,
    listing: address(l.listing),
    mockMint: address(l.mock_mint),
    cstockMint: address(l.cstock_mint),
    escrow: address(l.escrow_account),
    feedId: hexToBytes(l.feed_id_hex),
    decimals: l.decimals,
    haircutBps: BigInt(l.haircut_bps),
    maxPriceAgeSlots: l.max_price_age_slots,
    maxPublishAgeSecs: l.max_publish_age_secs,
    priceSource: l.price_source ?? priceSourceTag(l.source),
    priceAccount: l.price_account ? address(l.price_account) : null,
  };
}

/** A descriptor written before the schedule: its one collateral becomes listing #0 (`listing` is filled in by `fetchDeployment`). */
function legacyListing(raw: Deployment): RawListing {
  return {
    key: "mock_tsla",
    symbol: "TSLAx-mock",
    source: "pyth",
    listing: raw.cstock_mint, // overwritten with the derived `["listing", cstock_mint]` PDA below
    mock_mint: raw.mock_mint,
    cstock_mint: raw.cstock_mint,
    escrow_account: raw.escrow_account,
    feed_id_hex: raw.feed_id_hex,
    decimals: raw.decimals,
    haircut_bps: 15_000,
    max_price_age_slots: 1_200,
    max_publish_age_secs: 3_600,
  };
}

function view(raw: Deployment, adminUrl: string | null): DeploymentView {
  const listings = (raw.listings?.length ? raw.listings : [legacyListing(raw)]).map(listingView);
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
    listings,
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
      return withListingPdas(view(raw, url));
    }
  }
  const bundled = bundledDeployment as unknown as Deployment;
  if (!bundled?.mock_mint) throw new Error("no deployment: admin service unreachable and no bundled copy");
  return withListingPdas(view(bundled, null));
}

/** A descriptor without `listings` names no PDA for its one collateral: derive it. */
async function withListingPdas(v: DeploymentView): Promise<DeploymentView> {
  if (v.raw.listings?.length) return v;
  const listings = await Promise.all(v.listings.map(async (l) => ({ ...l, listing: await pda.listing(l.cstockMint) })));
  return { ...v, listings };
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

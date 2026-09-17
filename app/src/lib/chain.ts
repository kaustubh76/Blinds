/** One RPC client and the admin service's deployment descriptor. Everything on-chain is read here. */
import { type Address, address, createSolanaRpc } from "@solana/kit";
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
  /** Whether the admin service answered — i.e. whether `POST /join` can work right now. */
  faucet: boolean;
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

function view(raw: Deployment, faucet: boolean): DeploymentView {
  return {
    raw,
    faucet,
    mockMint: address(raw.mock_mint),
    cstockMint: address(raw.cstock_mint),
    escrow: address(raw.escrow_account),
    feedId: hexToBytes(raw.feed_id_hex),
    auditorPubkey: hexToBytes(raw.auditor_elgamal_pubkey_hex),
    decimals: raw.decimals,
  };
}

/**
 * The deployment descriptor. Preferred live from the admin service (which also tells us the faucet
 * is up); otherwise the copy committed to the repo, so a judge with only a browser still gets the
 * market, the explorer and their own positions.
 */
export async function fetchDeployment(): Promise<DeploymentView> {
  // No admin URL configured (a hosted build): skip the probe and go straight to the bundled copy.
  if (config.adminUrl) {
    try {
      const res = await fetch(`${config.adminUrl}/deployment`, { signal: AbortSignal.timeout(4_000) });
      if (res.ok) return view((await res.json()) as Deployment, true);
    } catch {
      // admin service down or unreachable from this browser — fall through
    }
  }
  const bundled = bundledDeployment as unknown as Deployment;
  if (!bundled?.mock_mint) throw new Error("no deployment: admin service unreachable and no bundled copy");
  return view(bundled, false);
}

/** `POST /join`: registers the wallet as a member and funds it with mock stock + fee SOL (demo faucet). */
export async function joinDesk(args: { wallet: Address; elgamalPubkey: Uint8Array; mockAccount: Address }) {
  const res = await fetch(`${config.adminUrl}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wallet: args.wallet,
      elgamal_pubkey_hex: bytesToHex(args.elgamalPubkey),
      mock_account: args.mockAccount,
    }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text || `join failed: ${res.status}`);
  return text;
}

/** Rent for a proof context account of `space` bytes. */
export const rentFor = async (space: number): Promise<bigint> =>
  BigInt(await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send());

/** One RPC client and the admin service's deployment descriptor. Everything on-chain is read here. */
import { type Address, address, createSolanaRpc } from "@solana/kit";
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

export async function fetchDeployment(): Promise<DeploymentView> {
  const res = await fetch(`${config.adminUrl}/deployment`);
  if (!res.ok) throw new Error(`admin service: ${res.status}`);
  const raw = (await res.json()) as Deployment;
  return {
    raw,
    mockMint: address(raw.mock_mint),
    cstockMint: address(raw.cstock_mint),
    escrow: address(raw.escrow_account),
    feedId: hexToBytes(raw.feed_id_hex),
    auditorPubkey: hexToBytes(raw.auditor_elgamal_pubkey_hex),
    decimals: raw.decimals,
  };
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

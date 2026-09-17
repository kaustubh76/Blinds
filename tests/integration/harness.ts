/** Shared helpers: RPC, deployment, funded keypair members, signature-derived keys, polling. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  type Address,
  address,
  createSolanaRpc,
  generateKeyPairSigner,
  getAddressEncoder,
  type KeyPairSigner,
  lamports,
  signBytes,
} from "@solana/kit";
import {
  buildOnboardPlan,
  fetchConfidentialAccount,
  memberSigningMessage,
  pda,
  proofs,
  sendPlan,
  tokenAccountSigningMessage,
} from "@thewindow/solana-sdk";

export const ROOT = resolve(import.meta.dirname, "../..");
export const RPC_URL = process.env.WINDOW_RPC_URL ?? "http://127.0.0.1:8899";
export const ADMIN_URL = `http://127.0.0.1:${process.env.WINDOW_ADMIN_PORT ?? 9091}`;
export const rpc = createSolanaRpc(RPC_URL);

export interface Deployment {
  mock_mint: string;
  cstock_mint: string;
  decimals: number;
  escrow_account: string;
  feed_id_hex: string;
  auditor_elgamal_pubkey_hex: string;
  listings?: Array<{
    key: string;
    symbol: string;
    source: string;
    listing: string;
    mock_mint: string;
    cstock_mint: string;
    escrow_account: string;
    feed_id_hex: string;
    haircut_bps: number;
    max_publish_age_secs: number;
  }>;
  agents: Array<{ wallet: string; role: string }>;
}

/** One listing of the collateral schedule, as the tests address it. */
export interface ListingT {
  key: string;
  symbol: string;
  listing: Address;
  mockMint: Address;
  cstockMint: Address;
  escrow: Address;
  feedId: Uint8Array;
  haircutBps: bigint;
  maxPublishAgeSecs: number;
}
export const deployment = JSON.parse(readFileSync(resolve(ROOT, "deployments/localnet.json"), "utf8")) as Deployment;
export const hexToBytes = (h: string) => Uint8Array.from(h.match(/../g)?.map((b) => Number.parseInt(b, 16)) ?? []);
export const bytesToHex = (b: ArrayLike<number>) => Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
export const mockMint = address(deployment.mock_mint);
export const cstockMint = address(deployment.cstock_mint);
export const escrow = address(deployment.escrow_account);
export const feedId = hexToBytes(deployment.feed_id_hex);
/** Listing #0 — the original collateral, `["listing", cstock_mint]`. */
export const listing = await pda.listing(cstockMint);
/** The whole schedule the setup wrote (listing #0 first). */
export const listings: ListingT[] = (deployment.listings ?? []).map((l) => ({
  key: l.key,
  symbol: l.symbol,
  listing: address(l.listing),
  mockMint: address(l.mock_mint),
  cstockMint: address(l.cstock_mint),
  escrow: address(l.escrow_account),
  feedId: hexToBytes(l.feed_id_hex),
  haircutBps: BigInt(l.haircut_bps),
  maxPublishAgeSecs: l.max_publish_age_secs,
}));
export const auditorPubkey = hexToBytes(deployment.auditor_elgamal_pubkey_hex);
export const rentFor = async (space: number) =>
  BigInt(await rpc.getMinimumBalanceForRentExemption(BigInt(space)).send());

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function waitFor<T>(
  label: string,
  f: () => Promise<T | null | undefined | false>,
  timeoutMs = 120_000,
): Promise<T> {
  const started = Date.now();
  for (;;) {
    const v = await f();
    if (v) return v;
    if (Date.now() - started > timeoutMs) throw new Error(`timeout waiting for ${label}`);
    await sleep(1_000);
  }
}

export async function airdrop(to: Address, sol: number): Promise<void> {
  const sig = await rpc.requestAirdrop(to, lamports(BigInt(Math.round(sol * 1e9)))).send();
  await waitFor(`airdrop ${sig}`, async () => {
    const s = await rpc.getSignatureStatuses([sig]).send();
    return s.value[0]?.confirmationStatus === "confirmed" || s.value[0]?.confirmationStatus === "finalized";
  });
}

/** A member driven exactly as the dashboard drives a wallet: two message signatures, one keypair. */
export interface Member {
  signer: KeyPairSigner;
  address: Address;
  memberSignature: Uint8Array;
  tokenSignature: Uint8Array;
  elgamalPubkey: Uint8Array;
  mockAta: Address;
  cstockAta: Address;
  /** The listing the member's accounts are on (undefined only for a descriptor without listings). */
  on: ListingT | undefined;
}

/** A member whose token accounts sit on `on` (listing #0 by default) — the dashboard's listing picker. */
export async function newMember(on?: ListingT): Promise<Member> {
  const signer = await generateKeyPairSigner();
  const [mockAta, cstockAta] = await Promise.all([
    pda.ata(signer.address, on?.mockMint ?? mockMint),
    pda.ata(signer.address, on?.cstockMint ?? cstockMint),
  ]);
  const memberSignature = new Uint8Array(await signBytes(signer.keyPair.privateKey, memberSigningMessage()));
  const tokenSignature = new Uint8Array(
    await signBytes(
      signer.keyPair.privateKey,
      tokenAccountSigningMessage(new Uint8Array(getAddressEncoder().encode(cstockAta))),
    ),
  );
  const w = await proofs();
  const elgamalPubkey = new Uint8Array(w.elgamal_pubkey_from_signature(memberSignature));
  return {
    signer,
    address: signer.address,
    memberSignature,
    tokenSignature,
    elgamalPubkey,
    mockAta,
    cstockAta,
    on: on ?? listings[0],
  };
}

/** POST /join then the onboarding plan — the dashboard's steps 2 and 3. */
export async function onboard(m: Member): Promise<void> {
  const res = await fetch(`${ADMIN_URL}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      wallet: m.address,
      elgamal_pubkey_hex: bytesToHex(m.elgamalPubkey),
      // the faucet mints listing #0 into this account and every other listing into the wallet's ATAs
      mock_account: await pda.ata(m.address, mockMint),
    }),
  });
  if (!res.ok) throw new Error(`join: ${res.status} ${await res.text()}`);
  const memberPda = await pda.member(m.address);
  await waitFor("member record", () =>
    rpc
      .getAccountInfo(memberPda, { encoding: "base64" })
      .send()
      .then((a) => a.value),
  );
  const cstock = await fetchConfidentialAccount(rpc, m.cstockAta);
  const plan = await buildOnboardPlan({
    member: m.signer,
    mockMint: m.on?.mockMint ?? mockMint,
    cstockMint: m.on?.cstockMint ?? cstockMint,
    tokenSignature: m.tokenSignature,
    mockAtaExists: true,
    cstockAtaExists: cstock.exists,
    cstockConfigured: cstock.configured,
  });
  await sendPlan(rpc, plan, m.signer);
}

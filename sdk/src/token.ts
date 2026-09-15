/**
 * Token-2022 lens for the member's accounts: the public mock-xStock balance, the confidential
 * cSTOCK-W extension bytes (ciphertexts only — decryption happens in the owner's browser through
 * the wasm with the wallet-derived key) and the mint's `ScaledUiAmount` multiplier.
 */

import type { Address, Rpc, SolanaRpcApi } from "@solana/kit";
import { type Extension, fetchMaybeMint, fetchMaybeToken } from "@solana-program/token-2022";

export interface ConfidentialAccountView {
  address: Address;
  /** Public (non-confidential) balance in base units. */
  amount: bigint;
  /** ElGamal public key registered on the account. */
  elgamalPubkey: Address;
  /** 64-byte ElGamal ciphertext of the available balance. */
  availableBalance: Uint8Array;
  /** 36-byte AE ciphertext the owner can decrypt without discrete log. */
  decryptableAvailableBalance: Uint8Array;
  pendingBalanceLo: Uint8Array;
  pendingBalanceHi: Uint8Array;
  pendingBalanceCreditCounter: bigint;
}

function extensionsOf(exts: { __option: string; value?: readonly Extension[] } | undefined): readonly Extension[] {
  return exts?.__option === "Some" && exts.value ? exts.value : [];
}

/** `null` when the account does not exist; `configured: false` when it lacks the CT extension. */
export async function fetchConfidentialAccount(
  rpc: Rpc<SolanaRpcApi>,
  address: Address,
): Promise<{ exists: boolean; configured: boolean; amount: bigint; view: ConfidentialAccountView | null }> {
  const acc = await fetchMaybeToken(rpc, address);
  if (!acc.exists) return { exists: false, configured: false, amount: 0n, view: null };
  const ct = extensionsOf(acc.data.extensions as never).find((e) => e.__kind === "ConfidentialTransferAccount");
  if (ct?.__kind !== "ConfidentialTransferAccount")
    return { exists: true, configured: false, amount: acc.data.amount, view: null };
  return {
    exists: true,
    configured: true,
    amount: acc.data.amount,
    view: {
      address,
      amount: acc.data.amount,
      elgamalPubkey: ct.elgamalPubkey,
      availableBalance: new Uint8Array(ct.availableBalance),
      decryptableAvailableBalance: new Uint8Array(ct.decryptableAvailableBalance),
      pendingBalanceLo: new Uint8Array(ct.pendingBalanceLow),
      pendingBalanceHi: new Uint8Array(ct.pendingBalanceHigh),
      pendingBalanceCreditCounter: ct.pendingBalanceCreditCounter,
    },
  };
}

/** Public token balance in base units (0 when the account does not exist). */
export async function fetchTokenAmount(rpc: Rpc<SolanaRpcApi>, address: Address): Promise<bigint | null> {
  const acc = await fetchMaybeToken(rpc, address);
  return acc.exists ? acc.data.amount : null;
}

/** The effective `ScaledUiAmount` multiplier of a mint (1 when the extension is absent). */
export async function fetchMultiplier(
  rpc: Rpc<SolanaRpcApi>,
  mint: Address,
): Promise<{ multiplier: number; decimals: number; supply: bigint }> {
  const acc = await fetchMaybeMint(rpc, mint);
  if (!acc.exists) throw new Error(`mint ${mint} not found`);
  const cfg = extensionsOf(acc.data.extensions as never).find((e) => e.__kind === "ScaledUiAmountConfig");
  let multiplier = 1;
  if (cfg && cfg.__kind === "ScaledUiAmountConfig") {
    const now = BigInt(Math.floor(Date.now() / 1000));
    multiplier = now >= cfg.newMultiplierEffectiveTimestamp ? cfg.newMultiplier : cfg.multiplier;
  }
  return { multiplier, decimals: acc.data.decimals, supply: acc.data.supply };
}

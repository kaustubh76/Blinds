/** Re-verifies a print from chain data alone (the explorer badge). */
import type { Address, Rpc, Signature, SolanaRpcApi } from "@solana/kit";
import * as pda from "./pda.js";
import { PROGRAMS, ZK_ELGAMAL_PROOF_PROGRAM } from "./programs.js";
import { withRpcRetry } from "./send.js";
import { proofs } from "./wasm.js";

/** The stages of a re-verification, in order, for a UI that wants to show the work. */
export type VerifyStage = "accounts" | "signatures" | "transactions" | "proofs" | "verify";
export interface VerifyStageDetail {
  count?: number;
  total?: number;
}
export type OnVerifyStage = (stage: VerifyStage, detail?: VerifyStageDetail) => void;

export interface PrintVerdict {
  ok: boolean;
  nonzero: number;
  proven: number;
  r_star_recomputed: number | null;
  failures: string[];
  proofTransactions: string[];
}

/**
 * Downloads the epoch and print accounts and every `attest_ticks` transaction of the epoch,
 * extracts the inline `VerifyZeroCiphertext` proof data, and re-runs the verifier in wasm.
 */
export async function verifyPrint(
  rpc: Rpc<SolanaRpcApi>,
  epochIndex: bigint,
  opts: { onStage?: OnVerifyStage } = {},
): Promise<PrintVerdict> {
  const stage: OnVerifyStage = opts.onStage ?? (() => {});
  stage("accounts", { total: 2 });
  const [epochAddr, printAddr] = await Promise.all([pda.epoch(epochIndex), pda.print(epochIndex)]);
  const [epochAcc, printAcc] = await Promise.all([
    withRpcRetry(() => rpc.getAccountInfo(epochAddr, { encoding: "base64" }).send()),
    withRpcRetry(() => rpc.getAccountInfo(printAddr, { encoding: "base64" }).send()),
  ]);
  if (!epochAcc.value || !printAcc.value)
    return {
      ok: false,
      nonzero: 0,
      proven: 0,
      r_star_recomputed: null,
      failures: ["epoch or print account missing"],
      proofTransactions: [],
    };
  const epochData = Uint8Array.from(atob(epochAcc.value.data[0]), (c) => c.charCodeAt(0));
  const printData = Uint8Array.from(atob(printAcc.value.data[0]), (c) => c.charCodeAt(0));
  // Every transaction touching the Print account that carried inline PoCD proofs.
  stage("signatures");
  const sigs = await withRpcRetry(() => rpc.getSignaturesForAddress(printAddr, { limit: 100 }).send());
  stage("transactions", { count: 0, total: sigs.length });
  const chunks: Uint8Array[] = [];
  const used: string[] = [];
  for (const [i, s] of sigs.entries()) {
    const tx = await withRpcRetry(() =>
      rpc.getTransaction(s.signature as Signature, { encoding: "json", maxSupportedTransactionVersion: 0 }).send(),
    );
    stage("transactions", { count: i + 1, total: sigs.length });
    if (!tx || tx.meta?.err) continue;
    const keys = tx.transaction.message.accountKeys as unknown as Address[];
    for (const ix of tx.transaction.message.instructions) {
      if (keys[ix.programIdIndex] !== ZK_ELGAMAL_PROOF_PROGRAM) continue;
      const data = base58Decode(ix.data);
      if (data[0] === 1 && data.length === 193) {
        chunks.push(data.subarray(1));
        used.push(s.signature);
      }
    }
  }
  stage("proofs", { count: chunks.length });
  const all = new Uint8Array(chunks.length * 192);
  for (const [i, c] of chunks.entries()) all.set(c, i * 192);
  stage("verify", { count: chunks.length });
  const w = await proofs();
  const v = w.verify_print(epochData, printData, all) as Omit<PrintVerdict, "proofTransactions">;
  return { ...v, r_star_recomputed: v.r_star_recomputed ?? null, proofTransactions: [...new Set(used)] };
}

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58Decode(s: string): Uint8Array {
  const bytes: number[] = [0];
  for (const ch of s) {
    let carry = ALPHABET.indexOf(ch);
    if (carry < 0) throw new Error("bad base58");
    for (let i = 0; i < bytes.length; i++) {
      carry += (bytes[i] ?? 0) * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  for (const ch of s) {
    if (ch !== "1") break;
    bytes.push(0);
  }
  return Uint8Array.from(bytes.reverse());
}

export const oracleProgram = PROGRAMS.oracle;

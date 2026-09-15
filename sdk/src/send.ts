/**
 * Sends a `Plan` transaction by transaction: the fee payer (a wallet or a keypair) signs, the
 * plan's ephemeral context keypairs co-sign, and confirmation is polled over the given RPC — so the
 * same code runs in a browser against localnet (where wallets have no endpoint) and in Node.
 */
import {
  addSignersToTransactionMessage,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type TransactionSigner,
} from "@solana/kit";
import type { Plan, PlannedTx } from "./tx.js";

export interface StepReport {
  index: number;
  label: string;
  signature?: Signature;
  state: "pending" | "sent" | "confirmed" | "failed";
  error?: string;
}
export type OnStep = (report: StepReport) => void;

export async function confirmSignature(
  rpc: Rpc<SolanaRpcApi>,
  signature: Signature,
  timeoutMs = 60_000,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const st = await rpc.getSignatureStatuses([signature]).send();
    const s = st.value[0];
    if (s?.err) throw new Error(`transaction ${signature} failed: ${JSON.stringify(s.err)}`);
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`confirmation of ${signature} timed out`);
}

export async function sendPlannedTx(
  rpc: Rpc<SolanaRpcApi>,
  tx: PlannedTx,
  feePayer: TransactionSigner,
): Promise<Signature> {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(feePayer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(tx.instructions, m),
    (m) => addSignersToTransactionMessage(tx.extraSigners, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  try {
    await rpc
      .sendTransaction(getBase64EncodedWireTransaction(signed), {
        encoding: "base64",
        preflightCommitment: "confirmed",
      })
      .send();
  } catch (e) {
    throw new Error(`${tx.label}: ${describeSendError(e)}`);
  }
  await confirmSignature(rpc, signature);
  return signature;
}

/** Runs every transaction of a plan in order; stops at the first failure. */
export async function sendPlan(
  rpc: Rpc<SolanaRpcApi>,
  plan: Plan,
  feePayer: TransactionSigner,
  onStep?: OnStep,
): Promise<Signature[]> {
  const sigs: Signature[] = [];
  for (const [index, tx] of plan.txs.entries()) {
    onStep?.({ index, label: tx.label, state: "pending" });
    try {
      const signature = await sendPlannedTx(rpc, tx, feePayer);
      sigs.push(signature);
      onStep?.({ index, label: tx.label, signature, state: "confirmed" });
    } catch (e) {
      onStep?.({ index, label: tx.label, state: "failed", error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }
  return sigs;
}

function describeSendError(e: unknown): string {
  const message = e instanceof Error ? e.message : String(e);
  if (e && typeof e === "object" && "context" in e) {
    const ctx = (e as { context?: { logs?: string[] } }).context;
    const logs = ctx?.logs
      ?.filter((l) => /failed|Error|error/.test(l))
      .slice(-3)
      .join(" | ");
    return logs ? `${message} — ${logs}` : message;
  }
  return message;
}

/**
 * Sends an SDK `Plan` transaction by transaction: the wallet signs (fee payer + member), the
 * plan's ephemeral context keypairs co-sign, and confirmation is polled over our own RPC so the
 * flow works on localnet where wallets have no endpoint for the chain.
 */
import {
  addSignersToTransactionMessage,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  pipe,
  type Signature,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type TransactionModifyingSigner,
} from "@solana/kit";
import type { Plan, PlannedTx } from "@thewindow/solana-sdk";
import { rpc } from "./chain";

export interface StepReport {
  index: number;
  label: string;
  signature?: Signature;
  state: "pending" | "sent" | "confirmed" | "failed";
  error?: string;
}

export type OnStep = (report: StepReport) => void;

async function confirm(signature: Signature, timeoutMs = 60_000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    const st = await rpc.getSignatureStatuses([signature]).send();
    const s = st.value[0];
    if (s?.err) throw new Error(`transaction failed: ${JSON.stringify(s.err)}`);
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) return;
    await new Promise((r) => setTimeout(r, 700));
  }
  throw new Error("confirmation timed out");
}

export async function sendPlannedTx(tx: PlannedTx, signer: TransactionModifyingSigner): Promise<Signature> {
  const { value: blockhash } = await rpc.getLatestBlockhash({ commitment: "confirmed" }).send();
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(tx.instructions, m),
    (m) => addSignersToTransactionMessage(tx.extraSigners, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const signature = getSignatureFromTransaction(signed);
  await rpc
    .sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: "base64", preflightCommitment: "confirmed" })
    .send();
  await confirm(signature);
  return signature;
}

/** Runs every transaction of a plan in order; stops at the first failure. */
export async function sendPlan(plan: Plan, signer: TransactionModifyingSigner, onStep?: OnStep): Promise<Signature[]> {
  const sigs: Signature[] = [];
  for (const [index, tx] of plan.txs.entries()) {
    onStep?.({ index, label: tx.label, state: "pending" });
    try {
      const signature = await sendPlannedTx(tx, signer);
      sigs.push(signature);
      onStep?.({ index, label: tx.label, signature, state: "confirmed" });
    } catch (e) {
      onStep?.({ index, label: tx.label, state: "failed", error: e instanceof Error ? e.message : String(e) });
      throw e;
    }
  }
  return sigs;
}

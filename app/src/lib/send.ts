/**
 * Plan sending over the app's RPC (see the SDK's `sendPlan` for the mechanics) — and the one place
 * every chain write passes through, so the developer console sees each call and each transaction.
 */
import {
  addSignersToTransactionMessage,
  appendTransactionMessageInstructions,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransactionMessageWithSigners,
  type TransactionModifyingSigner,
} from "@solana/kit";
import { type OnStep, type Plan, type StepReport, sendPlan as sdkSendPlan } from "@thewindow/solana-sdk";
import { retry, rpc } from "./chain";
import { devConsole } from "./console";

export type { OnStep, StepReport };

export interface Trace {
  /** What the app called, e.g. "buildBidPlan → sendPlan". */
  title: string;
  /** The redacted snippet from `asCode`. */
  code?: string;
}

const programsOf = (plan: Plan, i: number) =>
  Array.from(new Set(plan.txs[i]?.instructions.map((ix) => ix.programAddress as string) ?? []));

export const sendPlan = (plan: Plan, signer: TransactionModifyingSigner, onStep?: OnStep, trace?: Trace) => {
  const callId = devConsole.push({
    kind: "call",
    title: trace?.title ?? "sendPlan",
    ...(trace?.code ? { code: trace.code } : {}),
    programs: Array.from(new Set(plan.txs.flatMap((_, i) => programsOf(plan, i)))),
    detail: plan.txs.map((t, i) => ({
      label: t.label,
      instructions: t.instructions.length,
      programs: programsOf(plan, i),
    })),
  });
  const txIds = new Map<number, number>();
  const log: OnStep = (r) => {
    const existing = txIds.get(r.index);
    const patch = {
      state: r.state,
      ...(r.signature ? { signature: r.signature as string } : {}),
      ...(r.error ? { error: r.error } : {}),
    };
    if (existing === undefined) {
      txIds.set(
        r.index,
        devConsole.push({
          kind: "tx",
          title: `${r.index + 1}/${plan.txs.length} ${r.label}`,
          programs: programsOf(plan, r.index),
          ...patch,
        }),
      );
    } else devConsole.update(existing, patch);
    onStep?.(r);
  };
  return sdkSendPlan(rpc, plan, signer, log).then(
    (sigs) => {
      devConsole.update(callId, { state: "confirmed" });
      return sigs;
    },
    (e: unknown) => {
      devConsole.update(callId, { state: "failed", error: e instanceof Error ? e.message : String(e) });
      throw e;
    },
  );
};

export interface SimulationView {
  /** The program error, as the RPC reported it, or null when the transaction would succeed. */
  err: string | null;
  /** Compute units the runtime charged for the simulated run. */
  unitsConsumed: number | null;
  logs: readonly string[];
  /** How many of the plan's transactions were simulated, and how many there are. */
  simulated: number;
  of: number;
  /** Stated on the page whenever `of > 1`, because a partial simulation is not a green light. */
  note?: string;
}

/**
 * Simulates the *first* transaction of a plan and nothing else.
 *
 * This is deliberately not `simulatePlan`. The plans that matter here create a ZK proof-context
 * account in transaction 1 and read it in 2 and 3, so simulating 2 against the current chain state
 * fails on an account that does not exist yet — a red result that means nothing. One transaction
 * simulated honestly beats three simulated misleadingly, and the caller is told which it got.
 */
export async function simulateOne(plan: Plan, signer: TransactionModifyingSigner): Promise<SimulationView> {
  const tx = plan.txs[0];
  if (!tx) throw new Error("the plan has no transactions to simulate");
  const { value: blockhash } = await retry(() => rpc.getLatestBlockhash({ commitment: "confirmed" }).send());
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayerSigner(signer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) => appendTransactionMessageInstructions(tx.instructions, m),
    (m) => addSignersToTransactionMessage(tx.extraSigners, m),
  );
  const signed = await signTransactionMessageWithSigners(message);
  const res = await retry(() =>
    rpc
      .simulateTransaction(getBase64EncodedWireTransaction(signed), {
        encoding: "base64",
        commitment: "confirmed",
        replaceRecentBlockhash: true,
      })
      .send(),
  );
  const v = res.value;
  const view: SimulationView = {
    err: v.err ? JSON.stringify(v.err, (_k, x) => (typeof x === "bigint" ? Number(x) : x)) : null,
    unitsConsumed: v.unitsConsumed === undefined ? null : Number(v.unitsConsumed),
    logs: v.logs ?? [],
    simulated: 1,
    of: plan.txs.length,
    ...(plan.txs.length > 1
      ? {
          note: `1 of ${plan.txs.length} simulated — the rest read a proof context this one creates`,
        }
      : {}),
  };
  devConsole.push({
    kind: "call",
    title: `simulate ${tx.label} (1/${plan.txs.length})`,
    state: view.err ? "failed" : "confirmed",
    ...(view.err ? { error: view.err } : {}),
    programs: Array.from(new Set(tx.instructions.map((ix) => ix.programAddress as string))),
    detail: {
      unitsConsumed: view.unitsConsumed,
      logs: view.logs.slice(-12),
      ...(view.note ? { note: view.note } : {}),
    },
  });
  return view;
}

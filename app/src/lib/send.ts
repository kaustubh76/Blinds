/**
 * Plan sending over the app's RPC (see the SDK's `sendPlan` for the mechanics) — and the one place
 * every chain write passes through, so the developer console sees each call and each transaction.
 */
import type { TransactionModifyingSigner } from "@solana/kit";
import { type OnStep, type Plan, type StepReport, sendPlan as sdkSendPlan } from "@thewindow/solana-sdk";
import { rpc } from "./chain";
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

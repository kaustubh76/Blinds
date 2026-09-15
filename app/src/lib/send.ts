/** Plan sending over the app's RPC; see the SDK's `sendPlan` for the mechanics. */
import type { TransactionModifyingSigner } from "@solana/kit";
import { type OnStep, type Plan, type StepReport, sendPlan as sdkSendPlan } from "@thewindow/solana-sdk";
import { rpc } from "./chain";

export type { OnStep, StepReport };

export const sendPlan = (plan: Plan, signer: TransactionModifyingSigner, onStep?: OnStep) =>
  sdkSendPlan(rpc, plan, signer, onStep);

/** Member flows shared by the tier-2 suites: the same SDK plans the dashboard builds. */
import {
  buildBidPlan,
  buildWrapPlan,
  fetchAuctionConfig,
  fetchConfidentialAccount,
  fetchEpoch,
  proofs,
  sendPlan,
} from "@thewindow/solana-sdk";
import { cstockMint, type Member, mockMint, rentFor, rpc, waitFor } from "./harness";

/** Shares each member wraps before bidding. */
export const SHARES = 1_000_000n; // 1,000.000

export async function balances(m: Member) {
  const w = await proofs();
  const acc = await fetchConfidentialAccount(rpc, m.cstockAta);
  if (!acc.view) throw new Error("no confidential view");
  const out = w.confidential_balances(
    m.tokenSignature,
    acc.view.decryptableAvailableBalance,
    acc.view.pendingBalanceLo,
    acc.view.pendingBalanceHi,
  ) as {
    available: string;
    pending: string;
  };
  return { available: BigInt(out.available), pending: BigInt(out.pending), view: acc.view };
}

export async function wrap(m: Member, amount: bigint) {
  const w = await proofs();
  const b = await balances(m);
  const plan = await buildWrapPlan({
    member: m.signer,
    mockMint,
    cstockMint,
    memberMock: m.mockAta,
    memberCstock: m.cstockAta,
    amount,
    pendingCreditCounter: b.view.pendingBalanceCreditCounter,
    newDecryptableBalance: new Uint8Array(
      w.encrypt_balance(m.tokenSignature, (b.available + b.pending + amount).toString()),
    ),
  });
  await sendPlan(rpc, plan, m.signer);
}

export async function bid(m: Member, side: 0 | 1, tick: number, size: bigint) {
  const cfg = await waitFor("open epoch with margin", async () => {
    const c = await fetchAuctionConfig(rpc);
    if (!c?.hasOpenEpoch) return null;
    const e = await fetchEpoch(rpc, c.currentEpoch);
    const slot = Number(await rpc.getSlot({ commitment: "confirmed" }).send());
    return e && slot + 6 < Number(e.startSlot + c.epochSlots) ? { c, e } : null;
  });
  const plan = await buildBidPlan({
    member: m.signer,
    signature: m.memberSignature,
    auditorPubkey: new Uint8Array(cfg.e.auditorPubkey),
    epoch: cfg.c.currentEpoch,
    side,
    tick,
    sizeMicroUsdc: size,
    sMin: cfg.c.sMin,
    rent: rentFor,
  });
  await sendPlan(rpc, plan, m.signer);
  return { epoch: cfg.c.currentEpoch, opening: plan.opening, ciphertext: plan.ciphertext };
}

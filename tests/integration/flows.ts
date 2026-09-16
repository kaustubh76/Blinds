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

export interface Order {
  member: Member;
  side: 0 | 1;
  tick: number;
  size: bigint;
}

/** An open epoch with at least `slotsNeeded` of its window left to submit into. */
async function openEpochWithMargin(slotsNeeded: number) {
  return waitFor(`open epoch with ${slotsNeeded} slots of margin`, async () => {
    const c = await fetchAuctionConfig(rpc);
    if (!c?.hasOpenEpoch) return null;
    const e = await fetchEpoch(rpc, c.currentEpoch);
    const slot = Number(await rpc.getSlot({ commitment: "confirmed" }).send());
    return e && slot + slotsNeeded < Number(e.startSlot + c.epochSlots) ? { c, e, epoch: c.currentEpoch } : null;
  });
}

/**
 * Submits several bids into **one** epoch. Clearing only crosses orders from the same epoch, so a
 * test about how a bid is matched has to get them all into one — and on the integration profile an
 * epoch is ~8 seconds, which a serial sequence of three bids does not fit inside. Sends them in
 * parallel against a freshly opened epoch and retries the batch if the window closes underneath it.
 */
export async function bidsTogether(orders: Order[], attempts = 6) {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    const cfg = await openEpochWithMargin(12);
    try {
      const results = await Promise.all(orders.map((o) => bid(o.member, o.side, o.tick, o.size, cfg.c.currentEpoch)));
      if (results.every((r) => r.epoch === cfg.c.currentEpoch)) return results;
    } catch (e) {
      lastError = e; // typically NotOpen: the window closed mid-batch, so try the next one
    }
  }
  throw new Error(`could not land ${orders.length} bids in one epoch: ${lastError ?? "epoch kept rolling"}`);
}

export async function bid(m: Member, side: 0 | 1, tick: number, size: bigint, epoch?: bigint) {
  const cfg = epoch === undefined ? await openEpochWithMargin(6) : await epochContext(epoch);
  const plan = await buildBidPlan({
    member: m.signer,
    signature: m.memberSignature,
    auditorPubkey: new Uint8Array(cfg.e.auditorPubkey),
    epoch: cfg.epoch,
    side,
    tick,
    sizeMicroUsdc: size,
    sMin: cfg.c.sMin,
    rent: rentFor,
  });
  await sendPlan(rpc, plan, m.signer);
  return { epoch: cfg.epoch, opening: plan.opening, ciphertext: plan.ciphertext };
}

async function epochContext(index: bigint) {
  const [c, e] = await Promise.all([fetchAuctionConfig(rpc), fetchEpoch(rpc, index)]);
  if (!c || !e) throw new Error(`epoch ${index} not found`);
  return { c, e, epoch: index };
}

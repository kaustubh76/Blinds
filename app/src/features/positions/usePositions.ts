/** Borrower flows after a match: lock (priced solvency proof) and deposit (confidential transfer to escrow). */
import { type Address, getAddressEncoder } from "@solana/kit";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { credit as creditNs } from "@thewindow/solana-sdk";
import {
  buildDepositPlan,
  buildLockPlan,
  collateralPledge,
  fetchConfidentialAccount,
  fetchEpoch,
  fetchMultiplier,
  fetchPrice,
  multiplierScaled,
  priceCents,
  proofs,
  solvencyScalars,
} from "@thewindow/solana-sdk";

type Loan = creditNs.Loan;

import type { UiWalletAccount } from "@wallet-standard/react";
import { asCode } from "../../lib/asCode";
import { findBid } from "../../lib/bidBook";
import { hexToBytes, rentFor, rpc } from "../../lib/chain";
import { useCreditConfig, useDeployment, useLoans, useTokenAccounts } from "../../lib/queries";
import { sendPlan } from "../../lib/send";
import { useAccountSigners, useSession } from "../../lib/wallet";
import { useSteps } from "../desk/useDesk";

const isZero = (b: ArrayLike<number>) => Array.from(b).every((x) => x === 0);

export function usePositions(account: UiWalletAccount) {
  const session = useSession();
  const wallet = session.address as Address;
  const { txSigner } = useAccountSigners(account);
  const qc = useQueryClient();
  const dep = useDeployment();
  const credit = useCreditConfig();
  const loans = useLoans(wallet);
  const accounts = useTokenAccounts(wallet, dep.data?.mockMint, dep.data?.cstockMint);
  const steps = useSteps();
  const invalidate = () => qc.invalidateQueries();

  /** Recovers (size, opening) of a loan from the bid book (full fill) or the sealed note (partial fill). */
  async function loanSecret(loanAddr: Address, loan: Loan): Promise<{ size: bigint; opening: Uint8Array }> {
    if (!session.memberSignature || !dep.data) throw new Error("derive keys on the desk first");
    const rec = findBid(wallet, loan.epoch, 1, loan.bidTick);
    if (!rec) throw new Error("this browser has no record of the bid (size + opening); the lock proof needs it");
    const w = await proofs();
    if (isZero(loan.openingNote)) return { size: BigInt(rec.sizeMicroUsdc), opening: hexToBytes(rec.opening) };
    const epoch = await fetchEpoch(rpc, loan.epoch);
    if (!epoch) throw new Error("epoch missing");
    const opening = new Uint8Array(
      w.open_note(
        session.memberSignature,
        new Uint8Array(epoch.auditorPubkey),
        new Uint8Array(loan.openingNote),
        new Uint8Array(getAddressEncoder().encode(loanAddr)),
      ),
    );
    const part = w.decrypt_small(
      session.memberSignature,
      new Uint8Array(loan.sizeCt.slice(0, 64)),
      rec.sizeMicroUsdc,
    ) as string | null | undefined;
    if (part == null) throw new Error("could not recover the partial-fill size");
    return { size: BigInt(part), opening };
  }

  const lock = useMutation({
    mutationFn: async ({ address, loan }: { address: Address; loan: Loan }) => {
      if (!session.memberSignature || !dep.data || !credit.data) throw new Error("not ready");
      steps.reset();
      const { size, opening } = await loanSecret(address, loan);
      const [epoch, price, mult] = await Promise.all([
        fetchEpoch(rpc, loan.epoch),
        fetchPrice(rpc, dep.data.feedId),
        fetchMultiplier(rpc, dep.data.mockMint),
      ]);
      if (!epoch || !price) throw new Error("epoch or price missing");
      const pc = priceCents(price.price, price.expo);
      const ms = multiplierScaled(mult.multiplier);
      const need = collateralPledge(size, solvencyScalars(pc, ms, credit.data.haircutBps));
      const args = {
        borrower: txSigner,
        signature: session.memberSignature,
        auditorPubkey: new Uint8Array(epoch.auditorPubkey),
        loan: address,
        loanCiphertext: new Uint8Array(loan.sizeCt),
        loanSizeMicroUsdc: size,
        loanOpening: opening,
        sharesMilli: need,
        priceCents: pc,
        multScaled: ms,
        haircutBps: credit.data.haircutBps,
        feedId: dep.data.feedId,
        mockMint: dep.data.mockMint,
        rent: rentFor,
      };
      const plan = await buildLockPlan(args);
      return sendPlan(plan, txSigner, steps.onStep, {
        title: "buildLockPlan → sendPlan (priced solvency proof)",
        code: asCode("buildLockPlan", args, {
          prelude:
            "// collateral = collateralPledge(size, solvencyScalars(priceCents, multScaled, haircutBps)); 6 transactions",
          result: "plan",
        }),
      });
    },
    onSuccess: invalidate,
  });

  const deposit = useMutation({
    mutationFn: async ({ address, loan }: { address: Address; loan: Loan }) => {
      const v = accounts.data?.cstock.view;
      if (!session.tokenSignature || !dep.data || !credit.data || !accounts.data || !v) throw new Error("not ready");
      steps.reset();
      const { size } = await loanSecret(address, loan);
      const need = collateralPledge(size, { kC: loan.kC, kL: loan.kL });
      const escrow = await fetchConfidentialAccount(rpc, credit.data.escrowAccount);
      if (!escrow.view) throw new Error("escrow account not configured");
      const args = {
        borrower: txSigner,
        tokenSignature: session.tokenSignature,
        borrowerCstock: accounts.data.cstockAta,
        cstockMint: dep.data.cstockMint,
        escrow: credit.data.escrowAccount,
        loan: address,
        availableCt: v.availableBalance,
        decryptable: v.decryptableAvailableBalance,
        amountMilli: need,
        escrowElgamalPubkey: new Uint8Array(getAddressEncoder().encode(escrow.view.elgamalPubkey)),
        auditorPubkey: dep.data.auditorPubkey,
        rent: rentFor,
      };
      const plan = await buildDepositPlan(args);
      return sendPlan(plan, txSigner, steps.onStep, {
        title: "buildDepositPlan → sendPlan (confidential transfer to escrow)",
        code: asCode("buildDepositPlan", args, { result: "plan" }),
      });
    },
    onSuccess: invalidate,
  });

  return {
    wallet,
    loans,
    credit,
    steps,
    lock,
    deposit,
    keysReady: !!session.memberSignature && !!session.tokenSignature,
  };
}

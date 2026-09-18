/** Borrower flows after a match: lock (priced solvency proof) and deposit (confidential transfer to escrow). */
import { type Address, getAddressEncoder } from "@solana/kit";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { credit as creditNs } from "@thewindow/solana-sdk";
import {
  buildDepositPlan,
  buildLockPlan,
  buildOnboardPlan,
  collateralPledge,
  fetchConfidentialAccount,
  fetchEpoch,
  fetchMultiplier,
  fetchPrice,
  fetchTokenAmount,
  multiplierScaled,
  pda,
  priceCents,
  proofs,
  solvencyScalars,
} from "@thewindow/solana-sdk";

type Loan = creditNs.Loan;

import type { UiWalletAccount } from "@wallet-standard/react";
import { asCode } from "../../lib/asCode";
import { findBid } from "../../lib/bidBook";
import { hexToBytes, type ListingView, rentFor, retry, rpc } from "../../lib/chain";
import { listingByPda, useSelectedListing } from "../../lib/listings";
import { useCreditConfig, useDeployment, useLoans } from "../../lib/queries";
import { sendPlan } from "../../lib/send";
import { useAccountSigners, useSession } from "../../lib/wallet";
import { useSteps } from "../desk/useDesk";

const isZero = (b: ArrayLike<number>) => Array.from(b).every((x) => x === 0);

export function usePositions(account: UiWalletAccount) {
  const session = useSession();
  const wallet = session.address as Address;
  const { txSigner, signToken } = useAccountSigners(account);
  const qc = useQueryClient();
  const dep = useDeployment();
  const credit = useCreditConfig();
  const loans = useLoans(wallet);
  const { listings, selected: selectedListing, select: selectListing } = useSelectedListing();
  const steps = useSteps();
  const invalidate = () => qc.invalidateQueries();

  /** Recovers (size, opening) of a loan from the bid book (full fill) or the sealed note (partial fill). */
  async function loanSecret(loanAddr: Address, loan: Loan): Promise<{ size: bigint; opening: Uint8Array }> {
    if (!session.memberSignature || !dep.data) throw new Error("derive keys on the desk first");
    const rec = findBid(wallet, loan.epoch, 1, loan.bidTick);
    if (!rec) throw new Error("this browser has no record of the bid (size + opening); the lock proof needs it");
    const w = await proofs();
    if (isZero(loan.openingNote)) return { size: BigInt(rec.sizeMicroUsdc), opening: hexToBytes(rec.opening) };
    const epoch = await retry(() => fetchEpoch(rpc, loan.epoch));
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

  // A query still retrying through the public RPC's 429s is not a reason to fail a click: wait for it.
  const settled = async <T>(
    q: { data: T | undefined; refetch: () => Promise<{ data: T | undefined }> },
    what: string,
  ) => {
    if (q.data !== undefined && q.data !== null) return q.data as NonNullable<T>;
    const r = await q.refetch();
    if (r.data === undefined || r.data === null) throw new Error(`${what} not loaded yet — try again in a moment`);
    return r.data as NonNullable<T>;
  };

  /** Lock under a listing — the selected one by default; the loan is bound to it from here on. */
  const lock = useMutation({
    mutationFn: async ({
      address,
      loan,
      listing,
    }: {
      address: Address;
      loan: Loan;
      listing?: ListingView | undefined;
    }) => {
      if (!session.memberSignature) throw new Error("derive keys on the desk first");
      await settled(dep, "the deployment");
      const l = listing ?? selectedListing;
      if (!l) throw new Error("no collateral listing selected");
      steps.reset();
      const { size, opening } = await loanSecret(address, loan);
      const [epoch, price, mult] = await Promise.all([
        retry(() => fetchEpoch(rpc, loan.epoch)),
        retry(() => fetchPrice(rpc, l.feedId)),
        retry(() => fetchMultiplier(rpc, l.mockMint)),
      ]);
      if (!epoch || !price) throw new Error(`epoch or ${l.symbol} price missing`);
      const pc = priceCents(price.price, price.expo);
      const ms = multiplierScaled(mult.multiplier);
      const need = collateralPledge(size, solvencyScalars(pc, ms, l.haircutBps));
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
        haircutBps: l.haircutBps,
        listing: l.listing,
        feedId: l.feedId,
        mockMint: l.mockMint,
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

  /** Deposit under the loan's own listing (`Loan.listing`), signing for that listing's account if this tab has not yet. */
  const deposit = useMutation({
    mutationFn: async ({ address, loan }: { address: Address; loan: Loan }) => {
      const depData = await settled(dep, "the deployment");
      const l = listingByPda(depData.listings, loan.listing);
      if (!l) throw new Error("this loan is bound to a listing this dashboard does not know — lock it first");
      const cstockAta = await pda.ata(wallet, l.cstockMint);
      let tokenSignature: Uint8Array | null = session.tokenSignatureFor(l.cstockMint);
      if (!tokenSignature) {
        const fresh = await signToken(new Uint8Array(getAddressEncoder().encode(cstockAta)));
        session.setSignatures({ token: fresh, tokenFor: l.cstockMint });
        tokenSignature = fresh;
      }
      const tokenSig: Uint8Array = tokenSignature;
      const own = await retry(() => fetchConfidentialAccount(rpc, cstockAta));
      const v = own.view;
      if (!v) throw new Error(`no configured ${l.symbol} confidential account — set it up and wrap on the Desk`);
      steps.reset();
      const { size } = await loanSecret(address, loan);
      const need = collateralPledge(size, { kC: loan.kC, kL: loan.kL });
      const escrow = await retry(() => fetchConfidentialAccount(rpc, l.escrow));
      if (!escrow.view) throw new Error("escrow account not configured");
      const args = {
        borrower: txSigner,
        tokenSignature: tokenSig,
        borrowerCstock: cstockAta,
        cstockMint: l.cstockMint,
        escrow: l.escrow,
        listing: l.listing,
        loan: address,
        availableCt: v.availableBalance,
        decryptable: v.decryptableAvailableBalance,
        amountMilli: need,
        escrowElgamalPubkey: new Uint8Array(getAddressEncoder().encode(escrow.view.elgamalPubkey)),
        auditorPubkey: depData.auditorPubkey,
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

  /**
   * A lender's confidential account on a loan's listing, so a default payout on that listing has
   * somewhere to land (the operator retries the release every tick until it does). Same two
   * transactions as the Desk's set-up, under the loan's listing rather than the selected one.
   */
  const receiveAccount = useMutation({
    mutationFn: async ({ loan }: { loan: Loan }) => {
      const depData = await settled(dep, "the deployment");
      const l = listingByPda(depData.listings, loan.listing);
      if (!l) throw new Error("this loan is bound to a listing this dashboard does not know");
      const [mockAta, cstockAta] = await Promise.all([pda.ata(wallet, l.mockMint), pda.ata(wallet, l.cstockMint)]);
      let tokenSignature: Uint8Array | null = session.tokenSignatureFor(l.cstockMint);
      if (!tokenSignature) {
        const fresh = await signToken(new Uint8Array(getAddressEncoder().encode(cstockAta)));
        session.setSignatures({ token: fresh, tokenFor: l.cstockMint });
        tokenSignature = fresh;
      }
      const [mockAmount, own] = await Promise.all([
        retry(() => fetchTokenAmount(rpc, mockAta)),
        retry(() => fetchConfidentialAccount(rpc, cstockAta)),
      ]);
      if (own.configured) return [];
      steps.reset();
      const args = {
        member: txSigner,
        mockMint: l.mockMint,
        cstockMint: l.cstockMint,
        tokenSignature,
        mockAtaExists: mockAmount !== null,
        cstockAtaExists: own.exists,
        cstockConfigured: own.configured,
      };
      const plan = await buildOnboardPlan(args);
      return sendPlan(plan, txSigner, steps.onStep, {
        title: `buildOnboardPlan → sendPlan (${l.symbol} account for a default payout)`,
        code: asCode("buildOnboardPlan", args, { result: "plan" }),
      });
    },
    onSuccess: invalidate,
  });

  return {
    wallet,
    dep,
    loans,
    credit,
    listings,
    selectedListing,
    selectListing,
    steps,
    lock,
    deposit,
    receiveAccount,
    keysReady: !!session.memberSignature,
  };
}

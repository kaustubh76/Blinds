/** Desk flows (onboard → wrap → bid). Components render state; every chain action lives here. */
import { type Address, getAddressEncoder } from "@solana/kit";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  applyPendingBalanceInstruction,
  buildBidPlan,
  buildOnboardPlan,
  buildWrapPlan,
  fetchEpoch,
  proofs,
} from "@thewindow/solana-sdk";
import type { UiWalletAccount } from "@wallet-standard/react";
import { useCallback, useState } from "react";
import { saveBid } from "../../lib/bidBook";
import { bytesToHex, joinDesk, rentFor, rpc } from "../../lib/chain";
import { useAuctionConfig, useDeployment, useMember, useTokenAccounts } from "../../lib/queries";
import { type OnStep, type StepReport, sendPlan } from "../../lib/send";
import { useAccountSigners, useSession } from "../../lib/wallet";

export function useSteps() {
  const [steps, setSteps] = useState<StepReport[]>([]);
  const onStep: OnStep = useCallback((r) => {
    setSteps((prev) => {
      const next = prev.filter((p) => p.index !== r.index);
      next.push(r);
      return next.sort((a, b) => a.index - b.index);
    });
  }, []);
  const reset = useCallback(() => setSteps([]), []);
  return { steps, onStep, reset };
}

export function useDesk(account: UiWalletAccount) {
  const session = useSession();
  const wallet = session.address as Address;
  const { txSigner, signMember, signToken } = useAccountSigners(account);
  const qc = useQueryClient();
  const dep = useDeployment();
  const cfg = useAuctionConfig();
  const member = useMember(wallet);
  const accounts = useTokenAccounts(wallet, dep.data?.mockMint, dep.data?.cstockMint);
  const steps = useSteps();

  const invalidate = () => qc.invalidateQueries();

  /** Member ElGamal public key derived from the member signature (in the browser, via wasm). */
  const memberKey = useQuery({
    queryKey: ["memberKey", wallet, session.memberSignature ? bytesToHex(session.memberSignature.slice(0, 8)) : ""],
    queryFn: async () => {
      if (!session.memberSignature) return null;
      const w = await proofs();
      return new Uint8Array(w.elgamal_pubkey_from_signature(session.memberSignature));
    },
    enabled: !!session.memberSignature,
    staleTime: Number.POSITIVE_INFINITY,
  });

  /** Owner-side decryption of the confidential balance (available, pending). */
  const balances = useQuery({
    queryKey: [
      "balances",
      wallet,
      accounts.data?.cstock.view?.pendingBalanceCreditCounter.toString(),
      accounts.dataUpdatedAt,
    ],
    queryFn: async () => {
      const v = accounts.data?.cstock.view;
      if (!v || !session.tokenSignature) return null;
      const w = await proofs();
      const out = w.confidential_balances(
        session.tokenSignature,
        v.decryptableAvailableBalance,
        v.pendingBalanceLo,
        v.pendingBalanceHi,
      ) as {
        available: string;
        pending: string;
      };
      return { available: BigInt(out.available), pending: BigInt(out.pending) };
    },
    enabled: !!accounts.data?.cstock.view && !!session.tokenSignature,
  });

  const deriveKeys = useMutation({
    mutationFn: async () => {
      if (!accounts.data) throw new Error("token accounts not loaded");
      const m = await signMember();
      const t = await signToken(new Uint8Array(getAddressEncoder().encode(accounts.data.cstockAta)));
      session.setSignatures({ member: m, token: t });
    },
  });

  const join = useMutation({
    mutationFn: async () => {
      if (!memberKey.data || !accounts.data) throw new Error("derive keys first");
      const sig = await joinDesk({ wallet, elgamalPubkey: memberKey.data, mockAccount: accounts.data.mockAta });
      await new Promise((r) => setTimeout(r, 1500));
      return sig;
    },
    onSuccess: invalidate,
  });

  const onboard = useMutation({
    mutationFn: async () => {
      if (!dep.data || !accounts.data || !session.tokenSignature) throw new Error("derive keys first");
      steps.reset();
      const plan = await buildOnboardPlan({
        member: wallet,
        mockMint: dep.data.mockMint,
        cstockMint: dep.data.cstockMint,
        tokenSignature: session.tokenSignature,
        mockAtaExists: accounts.data.mockAmount !== null,
        cstockAtaExists: accounts.data.cstock.exists,
        cstockConfigured: accounts.data.cstock.configured,
      });
      return sendPlan(plan, txSigner, steps.onStep);
    },
    onSuccess: invalidate,
  });

  const wrap = useMutation({
    mutationFn: async (amountMilli: bigint) => {
      const v = accounts.data?.cstock.view;
      if (!dep.data || !accounts.data || !v || !session.tokenSignature || !balances.data)
        throw new Error("set up the account first");
      steps.reset();
      const w = await proofs();
      const newBalance = balances.data.available + balances.data.pending + amountMilli;
      const plan = await buildWrapPlan({
        member: wallet,
        mockMint: dep.data.mockMint,
        cstockMint: dep.data.cstockMint,
        memberMock: accounts.data.mockAta,
        memberCstock: accounts.data.cstockAta,
        amount: amountMilli,
        pendingCreditCounter: v.pendingBalanceCreditCounter,
        newDecryptableBalance: new Uint8Array(w.encrypt_balance(session.tokenSignature, newBalance.toString())),
      });
      return sendPlan(plan, txSigner, steps.onStep);
    },
    onSuccess: invalidate,
  });

  const applyPending = useMutation({
    mutationFn: async () => {
      const v = accounts.data?.cstock.view;
      if (!accounts.data || !v || !session.tokenSignature || !balances.data) throw new Error("not ready");
      steps.reset();
      const w = await proofs();
      const nb = new Uint8Array(
        w.encrypt_balance(session.tokenSignature, (balances.data.available + balances.data.pending).toString()),
      );
      const ix = applyPendingBalanceInstruction(accounts.data.cstockAta, wallet, v.pendingBalanceCreditCounter, nb);
      return sendPlan(
        { txs: [{ label: "apply pending balance", instructions: [ix], extraSigners: [] }] },
        txSigner,
        steps.onStep,
      );
    },
    onSuccess: invalidate,
  });

  const bid = useMutation({
    mutationFn: async (args: { side: 0 | 1; tick: number; sizeMicroUsdc: bigint }) => {
      if (!cfg.data?.hasOpenEpoch || !session.memberSignature) throw new Error("no open epoch or keys missing");
      steps.reset();
      const epochIndex = cfg.data.currentEpoch;
      // The auditor key in force for this epoch is stamped on the Epoch account (rotation-safe).
      const epoch = await fetchEpoch(rpc, epochIndex);
      if (!epoch) throw new Error("epoch account missing");
      const plan = await buildBidPlan({
        member: wallet,
        signature: session.memberSignature,
        auditorPubkey: new Uint8Array(epoch.auditorPubkey),
        epoch: epochIndex,
        side: args.side,
        tick: args.tick,
        sizeMicroUsdc: args.sizeMicroUsdc,
        sMin: cfg.data.sMin,
        rent: rentFor,
      });
      const sigs = await sendPlan(plan, txSigner, steps.onStep);
      saveBid(wallet, {
        epoch: epochIndex.toString(),
        side: args.side,
        tick: args.tick,
        sizeMicroUsdc: args.sizeMicroUsdc.toString(),
        opening: bytesToHex(plan.opening),
        ciphertext: bytesToHex(plan.ciphertext),
        at: Date.now(),
      });
      return sigs;
    },
    onSuccess: invalidate,
  });

  return {
    wallet,
    dep,
    cfg,
    member,
    accounts,
    memberKey,
    balances,
    steps,
    deriveKeys,
    join,
    onboard,
    wrap,
    applyPending,
    bid,
  };
}

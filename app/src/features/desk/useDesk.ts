/** Desk flows (onboard → wrap → bid). Components render state; every chain action lives here. */
import { type Address, getAddressEncoder } from "@solana/kit";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  applyPendingBalanceInstruction,
  buildBidPlan,
  buildOnboardPlan,
  buildWrapPlan,
  fetchEpoch,
  fetchOracle,
  fetchPrint,
  PrintStatus,
  proofs,
} from "@thewindow/solana-sdk";
import type { UiWalletAccount } from "@wallet-standard/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { asCode } from "../../lib/asCode";
import { saveBid } from "../../lib/bidBook";
import { bytesToHex, joinDesk, rentFor, retry, rpc } from "../../lib/chain";
import { devConsole } from "../../lib/console";
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
      devConsole.push({
        kind: "call",
        title: "signMessage ×2 → ElGamal keys (in this tab)",
        code: [
          "// two wallet signatures are the key material; they never leave the tab",
          "const memberSignature = await signMessage({ message: sdk.memberSigningMessage() });",
          `const tokenSignature = await signMessage({ message: sdk.tokenAccountSigningMessage(addressBytes("${accounts.data.cstockAta}")) });`,
          "const w = await sdk.proofs();",
          "const elgamalPubkey = w.elgamal_pubkey_from_signature(memberSignature);",
        ].join("\n"),
        state: "confirmed",
      });
    },
  });

  const join = useMutation({
    mutationFn: async () => {
      if (!memberKey.data || !accounts.data) throw new Error("derive keys first");
      const id = devConsole.push({
        kind: "call",
        title: "POST /join (demo faucet: add_member + mint mock shares + fee SOL)",
        code: asCode(
          "joinDesk",
          { wallet, elgamalPubkey: memberKey.data, mockAccount: accounts.data.mockAta },
          {
            prelude: "// the administrator signs add_member; membership is public, positions are not",
          },
        ),
        state: "pending",
      });
      const r = await joinDesk({ wallet, elgamalPubkey: memberKey.data, mockAccount: accounts.data.mockAta }).catch(
        (e: unknown) => {
          devConsole.update(id, { state: "failed", error: e instanceof Error ? e.message : String(e) });
          throw e;
        },
      );
      devConsole.update(id, {
        state: "confirmed",
        ...(r.signature ? { signature: r.signature } : {}),
        detail: r.alreadyMember
          ? "already a member — nothing minted or sent"
          : "member added, 10,000 shares minted, 0.1 SOL sent",
      });
      // A fresh member's accounts land a moment after the faucet's transaction confirms.
      if (!r.alreadyMember) await new Promise((res) => setTimeout(res, 1500));
      return r;
    },
    onSuccess: invalidate,
  });

  const onboard = useMutation({
    mutationFn: async () => {
      if (!dep.data || !accounts.data || !session.tokenSignature) throw new Error("derive keys first");
      steps.reset();
      const args = {
        member: txSigner,
        mockMint: dep.data.mockMint,
        cstockMint: dep.data.cstockMint,
        tokenSignature: session.tokenSignature,
        mockAtaExists: accounts.data.mockAmount !== null,
        cstockAtaExists: accounts.data.cstock.exists,
        cstockConfigured: accounts.data.cstock.configured,
      };
      const plan = await buildOnboardPlan(args);
      return sendPlan(plan, txSigner, steps.onStep, {
        title: "buildOnboardPlan → sendPlan",
        code: asCode("buildOnboardPlan", args, { result: "plan" }),
      });
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
      const args = {
        member: txSigner,
        mockMint: dep.data.mockMint,
        cstockMint: dep.data.cstockMint,
        memberMock: accounts.data.mockAta,
        memberCstock: accounts.data.cstockAta,
        amount: amountMilli,
        pendingCreditCounter: v.pendingBalanceCreditCounter,
        newDecryptableBalance: new Uint8Array(w.encrypt_balance(session.tokenSignature, newBalance.toString())),
      };
      const plan = await buildWrapPlan(args);
      return sendPlan(plan, txSigner, steps.onStep, {
        title: "buildWrapPlan → sendPlan",
        code: asCode("buildWrapPlan", args, {
          prelude: "// newDecryptableBalance = w.encrypt_balance(tokenSignature, available + pending + amount)",
          result: "plan",
        }),
      });
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
        {
          title: "applyPendingBalanceInstruction → sendPlan",
          code: `const ix = sdk.applyPendingBalanceInstruction(address("${accounts.data.cstockAta}"), address("${wallet}"), ${v.pendingBalanceCreditCounter}n, newDecryptable);`,
        },
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
      const epoch = await retry(() => fetchEpoch(rpc, epochIndex));
      if (!epoch) throw new Error("epoch account missing");
      const bidArgs = {
        member: txSigner,
        signature: session.memberSignature,
        auditorPubkey: new Uint8Array(epoch.auditorPubkey),
        epoch: epochIndex,
        side: args.side,
        tick: args.tick,
        sizeMicroUsdc: args.sizeMicroUsdc,
        sMin: cfg.data.sMin,
        rent: rentFor,
      };
      const plan = await buildBidPlan(bidArgs);
      const sigs = await sendPlan(plan, txSigner, steps.onStep, {
        title: `buildBidPlan → sendPlan (${args.side === 1 ? "borrow" : "lend"} @ tick ${args.tick})`,
        code: asCode("buildBidPlan", bidArgs, {
          prelude: "// the size is encrypted in this tab (bid_proofs); the plan is 3 transactions",
          result: "plan",
        }),
      });
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

  // The latest rendered state, for the autopilot to wait on between steps (queries refetch after
  // every mutation; each step's preconditions are read from here, never from a stale closure).
  const latest = useRef({ keys: false, member: false, configured: false, balance: null as bigint | null, open: false });
  useEffect(() => {
    latest.current = {
      keys: !!session.memberSignature && !!memberKey.data,
      member: !!member.data,
      configured: !!accounts.data?.cstock.configured,
      balance: balances.data ? balances.data.available + balances.data.pending : null,
      open: !!cfg.data?.hasOpenEpoch,
    };
  });
  const waitFor = async (what: string, pred: () => boolean, ms = 30_000) => {
    const t0 = Date.now();
    while (!pred()) {
      if (Date.now() - t0 > ms) throw new Error(`autopilot: timed out waiting for ${what}`);
      await new Promise((r) => setTimeout(r, 400));
    }
  };

  /**
   * Runs the whole desk in one go — derive → join → set up → wrap → bid — skipping what is done.
   * Meant for the burner (no prompts); with an extension wallet it asks for each signature in turn.
   */
  const autopilot = useMutation({
    mutationFn: async (opts: { wrapShares: bigint; sizeMicroUsdc: bigint; side: 0 | 1 }) => {
      const note = (title: string) => devConsole.push({ kind: "note", title: `autopilot: ${title}` });
      if (!latest.current.keys) {
        note("deriving keys (2 signatures)");
        await deriveKeys.mutateAsync();
        await waitFor("keys", () => latest.current.keys);
      } else note("keys already derived");
      if (!latest.current.member) {
        if (!dep.data?.faucet)
          throw new Error("autopilot: the faucet is not reachable, so this wallet cannot be admitted");
        note("joining via the faucet");
        await join.mutateAsync();
        await waitFor("membership", () => latest.current.member);
      } else note("already a member");
      if (!latest.current.configured) {
        note("creating + configuring the confidential account");
        await onboard.mutateAsync();
        await waitFor("the confidential account", () => latest.current.configured);
        await waitFor("the decrypted balance", () => latest.current.balance !== null);
      } else note("confidential account already configured");
      if ((latest.current.balance ?? 0n) === 0n) {
        note(`wrapping ${opts.wrapShares.toString()} milli-shares`);
        await wrap.mutateAsync(opts.wrapShares);
        await waitFor("the wrapped balance", () => (latest.current.balance ?? 0n) > 0n);
      } else note("already holds cSTOCK-W");
      if (!latest.current.open) throw new Error("autopilot: no window is open — the keeper opens the next one");
      // Bid at the last clearing rate when there is one, so the bid is likely to match.
      const oracle = await retry(() => fetchOracle(rpc));
      let tick = 8;
      if (oracle?.hasPrinted) {
        const last = await retry(() => fetchPrint(rpc, oracle.lastPrintEpoch));
        if (last?.status === PrintStatus.Printed) tick = last.rStarTick;
      }
      note(`sealing a ${opts.side === 1 ? "borrow" : "lend"} bid at tick ${tick}`);
      const sigs = await bid.mutateAsync({ side: opts.side, tick, sizeMicroUsdc: opts.sizeMicroUsdc });
      note(`done — ${sigs.length} transactions for the bid; a match becomes a loan after the print`);
      return { tick, sigs };
    },
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
    autopilot,
  };
}

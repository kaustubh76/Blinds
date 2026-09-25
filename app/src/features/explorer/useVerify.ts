/** Re-verification with the work shown: each SDK stage timed as it happens, then the verdict. */

import { useMutation } from "@tanstack/react-query";
import type { oracle } from "@thewindow/solana-sdk";
import {
  clear,
  depthFromPrint,
  PrintStatus,
  type PrintVerdict,
  type VerifyStage,
  verifyPrint,
} from "@thewindow/solana-sdk";
import { useCallback, useEffect, useRef, useState } from "react";
import { backdrop } from "../../lib/backdrop";
import { rpc } from "../../lib/chain";

export type UiStage = VerifyStage | "clear";

export interface StageRecord {
  stage: UiStage;
  startedAt: number;
  endedAt?: number;
  count?: number;
  total?: number;
}

export interface VerifyResult {
  verdict: PrintVerdict;
  /** r* and matched volume recomputed in JS from the proven sums, to compare with the print. */
  local: { rStar: number; matched: bigint } | null;
  elapsedMs: number;
}

/** What the chain published for this print, for comparison with what we recomputed. */
export interface OnChainPrint {
  rStar: number | null;
  matched: bigint;
}

export const onChainPrint = (print: oracle.Print | null): OnChainPrint | null =>
  print ? { rStar: print.status === PrintStatus.Printed ? print.rStarTick : null, matched: print.matchedVolume } : null;

/**
 * Did this re-verification actually clear? Two halves, and both must hold: every proof checked, and
 * the figures the administrator published match the ones we recomputed from the proven sums. A
 * mismatch is the fraud this page exists to expose, so it counts as a failure even when the proofs
 * themselves verify. `VerifyStepper` paints from this, and the backdrop only celebrates it.
 */
export function verified(result: VerifyResult, onChain: OnChainPrint | null): boolean {
  const agree =
    onChain && result.local ? onChain.rStar === result.local.rStar && onChain.matched === result.local.matched : null;
  return result.verdict.ok && agree !== false;
}

export function useVerify(print: oracle.Print | null) {
  const [stages, setStages] = useState<StageRecord[]>([]);
  const t0 = useRef(0);
  // While running, re-render 4×/s so the open stage's timer moves.
  const [, setTick] = useState(0);

  const onStage = useCallback((stage: UiStage, detail?: { count?: number; total?: number }) => {
    setStages((prev) => {
      const now = performance.now();
      const closed = prev.map((s) => (s.endedAt === undefined && s.stage !== stage ? { ...s, endedAt: now } : s));
      const open = closed.find((s) => s.stage === stage && s.endedAt === undefined);
      if (open) return closed.map((s) => (s === open ? { ...s, ...detail } : s));
      return [...closed, { stage, startedAt: now, ...detail }];
    });
  }, []);

  const m = useMutation<VerifyResult, Error, bigint>({
    mutationFn: async (index) => {
      setStages([]);
      t0.current = performance.now();
      const verdict = await verifyPrint(rpc, index, { onStage });
      onStage("clear");
      const c = print ? clear(depthFromPrint(print).curve) : null;
      const local = c ? { rStar: c.rStar, matched: c.matched } : null;
      setStages((prev) => prev.map((s) => (s.endedAt === undefined ? { ...s, endedAt: performance.now() } : s)));
      return { verdict, local, elapsedMs: performance.now() - t0.current };
    },
    // `verifyPrint` resolves with `ok: false` rather than throwing, so a bare `onSuccess` would
    // celebrate a print that had just been proven wrong.
    onSuccess: (r) => {
      if (verified(r, onChainPrint(print))) backdrop.pulse("print");
    },
  });

  useEffect(() => {
    if (!m.isPending) return;
    const id = setInterval(() => setTick((n) => n + 1), 250);
    return () => clearInterval(id);
  }, [m.isPending]);

  return { run: m.mutate, running: m.isPending, error: m.error, result: m.data ?? null, stages, reset: m.reset };
}

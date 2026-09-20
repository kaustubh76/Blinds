/**
 * `lockCollateral`: the priced solvency proof as one call — read the quote where the program reads
 * it, form the scalars, prove, send; and if the chain answers `DeltaMismatch` because the quote
 * moved between the read and the send (the keeper reposts, and a mock walks on every post), read
 * again and prove again, once. The alternative — every caller re-implementing the read/prove/retry
 * dance — is how the simulated agents, the tests and the dashboard each got it slightly wrong.
 */
import type { Address, Rpc, Signature, SolanaRpcApi, TransactionSigner } from "@solana/kit";
import { fetchQuote, type QuoteSource } from "./accounts.js";
import { type OnStep, sendPlan } from "./send.js";
import { collateralPledge, multiplierScaled, priceCents, type SolvencyScalars, solvencyScalars } from "./solvency.js";
import { fetchMultiplier } from "./token.js";
import { buildLockPlan, type Rent } from "./tx.js";
import { closeContext } from "./zk.js";

export interface LockCollateralArgs {
  borrower: TransactionSigner;
  signature: Uint8Array;
  auditorPubkey: Uint8Array;
  loan: Address;
  loanCiphertext: Uint8Array;
  loanSizeMicroUsdc: bigint;
  loanOpening: Uint8Array;
  /** The listing the loan is bound to, with what `fetchQuote` needs. */
  listing: Address;
  quote: QuoteSource;
  haircutBps: bigint;
  mockMint: Address;
  rent: Rent;
  /** Pledge this many milli-shares instead of the exact requirement (the desk pledges 160 %). */
  sharesMilli?: bigint;
  onStep?: OnStep;
  /** Called before each attempt with the quote it proves against. */
  onQuote?: (q: { priceCents: bigint; multScaled: bigint; scalars: SolvencyScalars; attempt: number }) => void;
}

export interface LockCollateralResult {
  signatures: Signature[];
  scalars: SolvencyScalars;
  priceCents: bigint;
  multScaled: bigint;
  sharesMilli: bigint;
  attempts: number;
}

/** `DeltaMismatch` (6022): the program formed E_Δ from a newer quote than the proof was made for. */
export const isDeltaMismatch = (e: unknown): boolean =>
  /DeltaMismatch|0x1786|custom program error: 6022|"Custom":6022/.test(String(e));

export async function lockCollateral(
  rpc: Rpc<SolanaRpcApi>,
  args: LockCollateralArgs,
  opts: { retries?: number } = {},
): Promise<LockCollateralResult> {
  const retries = opts.retries ?? 1;
  for (let attempt = 1; ; attempt++) {
    const [quote, mult] = await Promise.all([fetchQuote(rpc, args.quote), fetchMultiplier(rpc, args.mockMint)]);
    if (!quote) throw new Error("no usable quote where the program reads it — the chain would refuse this lock");
    const pc = priceCents(quote.price, quote.expo);
    const ms = multiplierScaled(mult.multiplier);
    const scalars = solvencyScalars(pc, ms, args.haircutBps);
    const sharesMilli = args.sharesMilli ?? collateralPledge(args.loanSizeMicroUsdc, scalars);
    args.onQuote?.({ priceCents: pc, multScaled: ms, scalars, attempt });
    const plan = await buildLockPlan({
      borrower: args.borrower,
      signature: args.signature,
      auditorPubkey: args.auditorPubkey,
      loan: args.loan,
      loanCiphertext: args.loanCiphertext,
      loanSizeMicroUsdc: args.loanSizeMicroUsdc,
      loanOpening: args.loanOpening,
      sharesMilli,
      priceCents: pc,
      multScaled: ms,
      haircutBps: args.haircutBps,
      listing: args.listing,
      feedId: args.quote.feedId,
      priceAccount: args.quote.priceAccount ?? undefined,
      mockMint: args.mockMint,
      rent: args.rent,
    });
    try {
      const signatures = await sendPlan(rpc, plan, args.borrower, args.onStep);
      return { signatures, scalars, priceCents: pc, multScaled: ms, sharesMilli, attempts: attempt };
    } catch (e) {
      if (attempt > retries || !isDeltaMismatch(e)) throw e;
      // The failed attempt's four proof contexts are verified accounts the program never closed;
      // reclaim their rent before proving against the new quote.
      const b = args.borrower.address;
      await sendPlan(
        rpc,
        {
          txs: [
            {
              label: "close proof contexts (quote moved)",
              instructions: plan.contexts.map((c) => closeContext(c, b, b)),
              extraSigners: [],
            },
          ],
        },
        args.borrower,
        args.onStep,
      ).catch(() => undefined);
    }
  }
}

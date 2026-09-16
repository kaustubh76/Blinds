/**
 * The 74 accumulators as they sit in the Epoch account: one sealed ciphertext per (side, tick),
 * each the homomorphic sum of every bid at that tick. Beside each, the sum the administrator
 * published for it once proven. The administrator holds the auditor key and therefore reads these
 * sums first; anyone can check the published ones against the proofs (the panel next door).
 */
import type { auction, oracle } from "@thewindow/solana-sdk";
import { EncryptedValue } from "../../components/EncryptedValue";
import { formatRate, formatUsdc } from "../../lib/format";

const TICKS = 37;

function proven(bitmap: ArrayLike<number> | undefined, side: 0 | 1, tick: number): boolean {
  if (!bitmap) return false;
  const i = side * TICKS + tick;
  return (((bitmap[i >> 3] ?? 0) >> (i & 7)) & 1) === 1;
}

export function AccumulatorWall({
  epoch,
  print,
  rStar,
  marginalTick,
}: {
  epoch: auction.Epoch;
  print: oracle.Print | null;
  rStar: number | null;
  marginalTick: number | null;
}) {
  const rows = Array.from({ length: TICKS }, (_, t) => t).reverse(); // high rates on top, like a ladder
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0 text-xs">
        <thead>
          <tr className="mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
            <th className="w-16 py-1 text-left font-normal">rate</th>
            <th className="py-1 text-left font-normal">
              <span className="mr-1.5 inline-block h-0.5 w-3 align-middle bg-lend" />
              lend · Σ commitment
            </th>
            <th className="w-28 py-1 pr-6 text-right font-normal">proven</th>
            <th className="py-1 pl-2 text-left font-normal">
              <span className="mr-1.5 inline-block h-0.5 w-3 align-middle bg-borrow" />
              borrow · Σ commitment
            </th>
            <th className="w-28 py-1 text-right font-normal">proven</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((t) => {
            const ask = epoch.accCommitment[0]?.[t];
            const bid = epoch.accCommitment[1]?.[t];
            const askN = epoch.bidCount[0]?.[t] ?? 0;
            const bidN = epoch.bidCount[1]?.[t] ?? 0;
            if (!ask || !bid) return null;
            const isR = rStar === t;
            const isMarginal = marginalTick === t && marginalTick !== rStar;
            const quiet = askN === 0 && bidN === 0;
            return (
              <tr
                key={t}
                className={`group transition-colors hover:bg-surface-2 ${isR ? "bg-accent/5" : ""} ${quiet ? "text-ink-3" : ""}`}
                data-tick={t}
              >
                <td className={`mono border-t border-line py-1 pr-2 ${isR ? "text-accent" : ""}`}>
                  {formatRate(t)}
                  {isR && <span className="ml-1 text-[9px] uppercase tracking-[0.12em]">r*</span>}
                  {isMarginal && (
                    <span className="ml-1 text-[9px] uppercase tracking-[0.12em] text-ink-3">marginal</span>
                  )}
                </td>
                <Cell bytes={ask} n={askN} side="lend" />
                <td className="num border-t border-line py-1 text-right text-ink-1">
                  {print && proven(print.provenBitmap, 0, t) ? (
                    formatUsdc(print.claimedSum[0]?.[t] ?? 0n)
                  ) : askN ? (
                    <span className="text-ink-3">…</span>
                  ) : (
                    ""
                  )}
                </td>
                <Cell bytes={bid} n={bidN} side="borrow" />
                <td className="num border-t border-line py-1 text-right text-ink-1">
                  {print && proven(print.provenBitmap, 1, t) ? (
                    formatUsdc(print.claimedSum[1]?.[t] ?? 0n)
                  ) : bidN ? (
                    <span className="text-ink-3">…</span>
                  ) : (
                    ""
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function Cell({
  bytes,
  n,
  side,
  className = "",
}: {
  bytes: ArrayLike<number>;
  n: number;
  side: "lend" | "borrow";
  className?: string;
}) {
  return (
    <td className={`border-t border-line py-1 pr-3 ${className}`}>
      {n > 0 ? (
        <span className="inline-flex items-center gap-2">
          <EncryptedValue bytes={bytes} size="sm" />
          <span className={`mono text-[10px] ${side === "lend" ? "text-lend" : "text-borrow"}`}>
            {n} bid{n === 1 ? "" : "s"}
          </span>
        </span>
      ) : (
        <span className="mono text-[10px] text-ink-3">identity</span>
      )}
    </td>
  );
}

/**
 * Explorer: what the chain holds for an epoch — 74 accumulator ciphertexts (never plaintext bids)
 * next to the 74 proven per-tick sums of the print — and a local re-verification of the print.
 */

import { useMutation } from "@tanstack/react-query";
import {
  cumulative,
  depthFromPrint,
  EpochStatus,
  PrintStatus,
  type PrintVerdict,
  verifyPrint,
} from "@thewindow/solana-sdk";
import { useState } from "react";
import { EncryptedValue } from "../../components/EncryptedValue";
import { Badge, Button, inputCls, Mono, Note, Panel } from "../../components/ui";
import { rpc } from "../../lib/chain";
import { formatRate, formatUsdc } from "../../lib/format";
import { useAuctionConfig, useEpoch, usePrint } from "../../lib/queries";
import { DepthChart } from "./DepthChart";

const STATUS: Record<number, string> = { 1: "open", 2: "closed", 3: "printed", 4: "no trade" };
const PSTATUS: Record<number, string> = { 1: "attesting", 2: "missed", 3: "printed", 4: "no trade" };

export function Explorer() {
  const cfg = useAuctionConfig();
  const [picked, setPicked] = useState<string>("");
  const latest = cfg.data ? cfg.data.currentEpoch : null;
  const index = picked !== "" ? BigInt(picked) : latest;
  const epoch = useEpoch(index);
  const print = usePrint(index);
  const verify = useMutation<PrintVerdict, Error, bigint>({ mutationFn: (i) => verifyPrint(rpc, i) });

  const depth = print.data ? depthFromPrint(print.data) : null;
  const proven = print.data?.provenBitmap ?? null;
  const bit = (side: number, tick: number) => {
    if (!proven) return false;
    const i = side * 37 + tick;
    return (((proven[i >> 3] ?? 0) >> (i & 7)) & 1) === 1;
  };

  return (
    <div className="grid gap-4">
      <Panel
        title="epoch"
        right={
          <div className="flex items-center gap-2">
            <input
              className={`${inputCls} w-28`}
              placeholder={latest?.toString() ?? "…"}
              value={picked}
              onChange={(e) => setPicked(e.target.value.replace(/\D/g, ""))}
            />
            {index !== null && (
              <Button
                onClick={() => verify.mutate(index)}
                disabled={verify.isPending || print.data?.status === PrintStatus.Attesting}
              >
                {verify.isPending ? "verifying…" : "Re-verify locally"}
              </Button>
            )}
          </div>
        }
      >
        {epoch.data ? (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <span>epoch {epoch.data.index.toString()}</span>
            <Badge tone={epoch.data.status === EpochStatus.Open ? "good" : "mute"}>{STATUS[epoch.data.status]}</Badge>
            <span className="text-mute">{epoch.data.totalBids} bids</span>
            {print.data && (
              <Badge tone={print.data.status === PrintStatus.Printed ? "accent" : "mute"}>
                print: {PSTATUS[print.data.status]}
              </Badge>
            )}
            {print.data?.status === PrintStatus.Printed && (
              <span>
                r* = {formatRate(print.data.rStarTick)} · matched {formatUsdc(print.data.matchedVolume)} · marginal
                ratio {print.data.marginalRatioNum.toString()}/{print.data.marginalRatioDen.toString()}
              </span>
            )}
            <Mono>
              auditor key{" "}
              {Array.from(epoch.data.auditorPubkey.slice(0, 8), (b) => b.toString(16).padStart(2, "0")).join("")}…
            </Mono>
          </div>
        ) : (
          <p className="text-sm text-mute">{epoch.isLoading ? "loading…" : "no such epoch"}</p>
        )}
        {verify.data && (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Badge tone={verify.data.ok ? "good" : "bad"}>
              {verify.data.ok ? "re-verified locally" : "verification failed"}
            </Badge>
            <span className="text-xs text-mute">
              {verify.data.proven}/{verify.data.nonzero} nonzero ticks proven · r* recomputed ={" "}
              {verify.data.r_star_recomputed === null ? "no trade" : formatRate(verify.data.r_star_recomputed)} ·{" "}
              {verify.data.proofTransactions.length} attest transactions re-checked in wasm
            </span>
            {verify.data.failures.map((f) => (
              <Note key={f} tone="bad">
                {f}
              </Note>
            ))}
          </div>
        )}
        {verify.error && <Note tone="bad">{verify.error.message}</Note>}
      </Panel>
      {depth && (
        <Panel title="proven depth curve">
          <DepthChart curve={cumulative(depth.curve)} rStar={depth.clearing?.rStar ?? null} />
        </Panel>
      )}
      {epoch.data && (
        <Panel title="on-chain accumulators · what anyone can read">
          <Note>
            Each cell is the homomorphic sum of every bid at that tick, as stored in the Epoch account. Individual bids
            are separate ciphertexts; the print discloses only these per-tick aggregates, each bound by a
            zero-ciphertext proof under the auditor key. The administrator holds the auditor key and therefore sees the
            sums first.
          </Note>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-mute">
                <tr>
                  <th className="text-left">rate</th>
                  <th className="text-left">lend Σ commitment</th>
                  <th className="text-right">proven lend</th>
                  <th className="text-left">borrow Σ commitment</th>
                  <th className="text-right">proven borrow</th>
                </tr>
              </thead>
              <tbody>
                {Array.from({ length: 37 }, (_, t) => t).map((t) => {
                  const ask = epoch.data?.accCommitment[0]?.[t];
                  const bid = epoch.data?.accCommitment[1]?.[t];
                  const askN = epoch.data?.bidCount[0]?.[t] ?? 0;
                  const bidN = epoch.data?.bidCount[1]?.[t] ?? 0;
                  if (!ask || !bid) return null;
                  return (
                    <tr key={t} className="border-t border-line">
                      <td className="py-1">{formatRate(t)}</td>
                      <td>
                        {askN ? (
                          <EncryptedValue bytes={ask} label={`${askN}×`} />
                        ) : (
                          <span className="text-mute">—</span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">
                        {bit(0, t) ? formatUsdc(depth?.curve.ask[t] ?? 0n) : askN ? "…" : ""}
                      </td>
                      <td>
                        {bidN ? (
                          <EncryptedValue bytes={bid} label={`${bidN}×`} />
                        ) : (
                          <span className="text-mute">—</span>
                        )}
                      </td>
                      <td className="text-right tabular-nums">
                        {bit(1, t) ? formatUsdc(depth?.curve.bid[t] ?? 0n) : bidN ? "…" : ""}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Panel>
      )}
    </div>
  );
}

/**
 * Explorer: what the chain holds for one epoch — the sealed accumulators, the proven sums, the
 * clearing — and the button that re-derives the print in this browser.
 */
import { clear, cumulative, depthFromPrint, EpochStatus, PrintStatus } from "@thewindow/solana-sdk";
import { useEffect, useState } from "react";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { EncryptedValue } from "../../components/EncryptedValue";
import { Icon } from "../../components/Icon";
import { Skeleton } from "../../components/Skeleton";
import { Stat } from "../../components/Stat";
import { Badge, Button, inputCls, Note } from "../../components/ui";
import { VerifyStepper } from "../../components/VerifyStepper";
import { config } from "../../config";
import { formatRate, formatSlotAge, formatUsdc } from "../../lib/format";
import { useAuctionConfig, useEpoch, usePrint, useSlot } from "../../lib/queries";
import { useHashRoute } from "../../lib/useHashRoute";
import { popcount } from "../../lib/useWindowClock";
import { AccumulatorWall } from "./AccumulatorWall";
import { DepthChart } from "./DepthChart";
import { useVerify } from "./useVerify";

const STATUS: Record<number, { label: string; tone: "good" | "mute" | "accent" | "warn" }> = {
  [EpochStatus.Open]: { label: "open", tone: "good" },
  [EpochStatus.Closed]: { label: "closed", tone: "mute" },
  [EpochStatus.Printed]: { label: "printed", tone: "accent" },
  [EpochStatus.NoTrade]: { label: "no trade", tone: "mute" },
};
/** The disclosed pro-rata ratio at the marginal tick, as a share and as the two sums it comes from. */
function marginalFill(num: bigint, den: bigint): string {
  if (num === den) return "in full";
  const pct = ((Number(num) * 100) / Number(den)).toFixed(1);
  return `${pct}% · ${formatUsdc(num)} of ${formatUsdc(den)}`;
}

const PSTATUS: Record<number, string> = {
  [PrintStatus.Attesting]: "attesting",
  [PrintStatus.Missed]: "missed",
  [PrintStatus.Printed]: "printed",
  [PrintStatus.NoTrade]: "no trade",
};

export function Explorer({ epochParam }: { epochParam?: string | undefined }) {
  const cfg = useAuctionConfig();
  const { go } = useHashRoute();
  const latest = cfg.data ? cfg.data.currentEpoch : null;
  const index = epochParam !== undefined && /^\d+$/.test(epochParam) ? BigInt(epochParam) : latest;
  const epoch = useEpoch(index);
  const print = usePrint(index);
  const slot = useSlot();
  const verify = useVerify(print.data ?? null);
  const [draft, setDraft] = useState("");
  // A verdict belongs to one epoch: forget it when the epoch changes.
  const { reset } = verify;
  const indexKey = index?.toString();
  useEffect(() => {
    if (indexKey !== undefined) reset();
  }, [reset, indexKey]);

  const depth = print.data ? depthFromPrint(print.data) : null;
  const clearing = depth ? clear(depth.curve) : null;
  const e = epoch.data;
  const p = print.data;
  const nav = (delta: bigint) => {
    if (index === null) return;
    const n = index + delta;
    if (n >= 0n && (latest === null || n <= latest)) go("explorer", n.toString());
  };

  return (
    <div className="grid gap-4">
      <Card
        eyebrow="epoch"
        title={
          <span className="flex items-center gap-3">
            <Button
              variant="ghost"
              size="sm"
              icon="chevronLeft"
              onClick={() => nav(-1n)}
              disabled={index === null || index === 0n}
              title="previous epoch ([)"
            >
              prev
            </Button>
            <span className="text-2xl font-semibold">{index?.toString() ?? "—"}</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => nav(1n)}
              disabled={index === null || latest === null || index >= latest}
              title="next epoch (])"
            >
              next <Icon name="chevronRight" size={12} />
            </Button>
            <form
              className="ml-2 flex items-center gap-1"
              onSubmit={(ev) => {
                ev.preventDefault();
                if (/^\d+$/.test(draft)) go("explorer", draft);
              }}
            >
              <input
                className={`${inputCls} w-24 py-1`}
                placeholder={latest?.toString() ?? "…"}
                value={draft}
                onChange={(ev) => setDraft(ev.target.value.replace(/\D/g, ""))}
                aria-label="go to epoch"
              />
            </form>
          </span>
        }
        right={
          e ? (
            <div className="flex flex-wrap justify-end gap-1.5">
              <Badge tone={STATUS[e.status]?.tone ?? "mute"}>{STATUS[e.status]?.label ?? e.status}</Badge>
              <Badge>{e.totalBids} sealed bids</Badge>
              {p && (
                <Badge tone={p.status === PrintStatus.Printed ? "accent" : "mute"}>print · {PSTATUS[p.status]}</Badge>
              )}
              {p && (
                <Badge>
                  {p.attested} / {popcount(p.nonzeroBitmap)} proven
                </Badge>
              )}
              {p && p.matchesPosted > 0 && <Badge>{p.matchesPosted} loans</Badge>}
            </div>
          ) : null
        }
      >
        {epoch.isLoading ? (
          <Skeleton className="h-12 w-full" />
        ) : !e ? (
          <EmptyState title="No such epoch.">
            Epochs are numbered from 0; the latest is {latest?.toString() ?? "—"}.
          </EmptyState>
        ) : (
          <div className="grid gap-4 sm:grid-cols-4">
            <Stat
              label="clearing rate"
              value={p?.status === PrintStatus.Printed ? formatRate(p.rStarTick) : p ? PSTATUS[p.status] : "—"}
              hint={p?.status === PrintStatus.Printed ? `tick ${p.rStarTick} · marginal ${p.marginalTick}` : undefined}
            />
            <Stat
              label="matched"
              value={p ? formatUsdc(p.matchedVolume) : "—"}
              hint={
                p && p.marginalRatioDen > 0n
                  ? `marginal fill ${marginalFill(p.marginalRatioNum, p.marginalRatioDen)}`
                  : undefined
              }
            />
            <Stat
              label="window"
              value={e.closeSlot > 0n ? `${formatSlotAge(Number(e.closeSlot - e.startSlot))}` : "open"}
              hint={
                slot.data !== undefined && p && p.finalizedSlot > 0n
                  ? `printed ${formatSlotAge(slot.data - Number(p.finalizedSlot))} ago`
                  : `opened at slot ${e.startSlot.toString()}`
              }
            />
            <div>
              <div className="mono text-[11px] uppercase tracking-[0.14em] text-ink-3">auditor key for this epoch</div>
              <div className="mt-1">
                <EncryptedValue bytes={e.auditorPubkey} />
              </div>
              <div className="mt-1 text-xs text-ink-3">
                every bid carries a handle under it; the administrator holds the secret
              </div>
            </div>
          </div>
        )}
      </Card>

      {e && (
        <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
          <Card eyebrow="accumulators · what anyone can read" title="74 sealed sums">
            <Note>
              Each cell is the homomorphic sum of every bid at that rate, exactly as stored in the Epoch account —
              individual bids stay separate ciphertexts under their owner's key and the auditor key. The print discloses
              only these per-tick sums, each bound by a zero-ciphertext proof. A member alone at a rate is revealed by
              that rate's sum; that is the disclosed cost of publishing a depth curve.
            </Note>
            <div className="mt-3">
              <AccumulatorWall
                epoch={e}
                print={p ?? null}
                rStar={p?.status === PrintStatus.Printed ? p.rStarTick : null}
                marginalTick={p?.status === PrintStatus.Printed ? p.marginalTick : null}
              />
            </div>
          </Card>
          <div className="grid gap-4 self-start">
            <Card
              eyebrow="re-verify"
              title="Derive the print yourself"
              right={
                <Button
                  onClick={() => index !== null && verify.run(index)}
                  loading={verify.running}
                  disabled={index === null || !p || p.status === PrintStatus.Attesting}
                  icon="shield"
                >
                  Re-verify in this browser
                </Button>
              }
              footer="Nothing here trusts the administrator: the accounts and the attest transactions come from the RPC you configured, and the proofs are checked by the same verifier the chain ran, compiled to wasm."
            >
              <VerifyStepper
                stages={verify.stages}
                running={verify.running}
                result={verify.result}
                error={verify.error}
                onChain={
                  p ? { rStar: p.status === PrintStatus.Printed ? p.rStarTick : null, matched: p.matchedVolume } : null
                }
                cluster={config.cluster === "devnet" ? "devnet" : "custom"}
              />
            </Card>
            <Card
              eyebrow="proven curve"
              title={
                clearing
                  ? `r* ${formatRate(clearing.rStar)} · ${formatUsdc(clearing.matched)} matched`
                  : "not printed yet"
              }
            >
              {depth ? (
                <DepthChart curve={cumulative(depth.curve)} rStar={clearing?.rStar ?? null} height={200} />
              ) : (
                <EmptyState title="The curve appears with the print." />
              )}
            </Card>
          </div>
        </div>
      )}
    </div>
  );
}

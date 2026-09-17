/** Market: the benchmark, the window, the series, the last curve, and how a print is made. */
import { cumulative, depthFromPrint, PrintStatus } from "@thewindow/solana-sdk";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { Icon } from "../../components/Icon";
import { LiveEvents } from "../../components/LiveEvents";
import { Skeleton } from "../../components/Skeleton";
import { Stat } from "../../components/Stat";
import { Badge } from "../../components/ui";
import { WindowClock } from "../../components/WindowClock";
import { config } from "../../config";
import { formatBps, formatRate, formatSlotAge, formatUsdc } from "../../lib/format";
import { useDeployment, useOracle, usePrint, useSeries, useSlot } from "../../lib/queries";
import { popcount, useWindowClock } from "../../lib/useWindowClock";
import { DepthChart } from "../explorer/DepthChart";
import { CollateralMark } from "./CollateralMark";
import { CollateralSchedule } from "./CollateralSchedule";
import { SeriesChart } from "./SeriesChart";

export function Market() {
  const dep = useDeployment();
  const oracle = useOracle();
  const slot = useSlot();
  const clock = useWindowClock();
  const lastPrinted = oracle.data?.hasPrinted ? oracle.data.lastPrintEpoch : null;
  const series = useSeries(clock.epoch ?? lastPrinted);
  const lastPrint = usePrint(lastPrinted);

  const o = oracle.data;
  const xonia = o?.hasPrinted && o.lastRStarTick !== 255 ? o.lastRStarTick : null;
  const points = (series.data ?? []).map((s) => ({
    epoch: Number(s.epoch),
    bps: s.print.status === PrintStatus.Printed ? s.print.rStarTick * 25 + 100 : null,
    matched: s.print.matchedVolume,
  }));
  const trend = points.filter((p) => p.bps !== null).map((p) => p.bps as number);
  const lastCurve = lastPrint.data ? depthFromPrint(lastPrint.data) : null;
  const printedAgo =
    lastPrint.data && slot.data !== undefined && lastPrint.data.finalizedSlot > 0n
      ? formatSlotAge(slot.data - Number(lastPrint.data.finalizedSlot))
      : null;

  return (
    <div className="grid gap-4">
      {/* Hero row: the number, and the window it comes from. */}
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card
          eyebrow="xONIA · xStocks overnight index average"
          right={
            o ? (
              <div className="flex flex-wrap justify-end gap-1.5">
                <Badge tone={o.stale ? "warn" : "good"} icon={o.stale ? "alert" : "check"}>
                  {o.stale ? `stale · τ ${o.tau}` : "live"}
                </Badge>
                {o.bandEdge ? (
                  <Badge tone="warn" icon="alert">
                    band edge
                  </Badge>
                ) : null}
                <Badge>{o.prints.toString()} prints</Badge>
              </div>
            ) : null
          }
        >
          {oracle.isLoading ? (
            <Skeleton className="h-14 w-40" />
          ) : (
            <Stat
              hero
              label="last print"
              value={xonia !== null ? formatRate(xonia) : "—"}
              unit={xonia !== null ? formatBps(xonia) : o?.hasPrinted ? "no trade" : "no print yet"}
              trend={trend}
              hint={
                o?.hasPrinted ? (
                  <>
                    epoch {o.lastPrintEpoch.toString()}
                    {printedAgo ? ` · printed ${printedAgo} ago` : ""} · {formatUsdc(o.lastMatched)} matched
                    {lastPrint.data ? ` · ${lastPrint.data.matchesPosted} loans` : ""}
                  </>
                ) : (
                  "the first window has not printed yet"
                )
              }
            />
          )}
          <p className="mt-4 max-w-[60ch] text-sm leading-relaxed text-ink-2">
            The overnight rate on tokenized stock, cleared every window from bids that arrive encrypted and are summed
            on chain. The rate is public. The price is public. The position never was.
          </p>
        </Card>
        <Card
          eyebrow="the window"
          title={clock.epoch !== null ? `epoch ${clock.epoch.toString()}` : "waiting for the keeper"}
        >
          <WindowClock clock={clock} size={150} />
        </Card>
      </div>

      {/* The series and the last curve. */}
      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card
          eyebrow="series"
          title="xONIA by epoch"
          right={<span className="mono text-xs text-ink-3">step = clearing rate r*</span>}
        >
          {points.length > 1 ? (
            <SeriesChart points={points} />
          ) : (
            <EmptyState icon="clock" title="One more print and there is a series.">
              Each window that clears adds a point; windows that do not cross are shown as hollow markers on the
              baseline.
            </EmptyState>
          )}
        </Card>
        <Card
          eyebrow="last proven curve"
          title={lastPrinted !== null ? `epoch ${lastPrinted.toString()}` : "—"}
          right={
            lastPrinted !== null ? (
              <a
                href={`#/explorer/${lastPrinted.toString()}`}
                className="flex items-center gap-1 text-xs text-accent hover:underline"
              >
                explore <Icon name="arrowRight" size={12} />
              </a>
            ) : null
          }
        >
          {lastCurve ? (
            <DepthChart curve={cumulative(lastCurve.curve)} rStar={lastCurve.clearing?.rStar ?? null} />
          ) : (
            <EmptyState title="No print yet.">
              The curve appears once the administrator has proven every nonzero tick.
            </EmptyState>
          )}
        </Card>
      </div>

      {/* How a print is made: live counts, each a door into the explorer. */}
      <div className="grid gap-4 md:grid-cols-4">
        <Tile n="1" label="sealed bids" value={clock.bids} hint="this window · summed on chain as ciphertexts" />
        <Tile
          n="2"
          label="nonzero ticks"
          value={lastPrint.data ? popcount(lastPrint.data.nonzeroBitmap) : "—"}
          hint="last print · each needs a proof of correct decryption"
        />
        <Tile
          n="3"
          label="proven / nonzero"
          value={lastPrint.data ? `${lastPrint.data.attested} / ${popcount(lastPrint.data.nonzeroBitmap)}` : "—"}
          hint="four proofs per transaction, checked by the ZK ElGamal program"
        />
        <Tile
          n="4"
          label="matches posted"
          value={lastPrint.data ? lastPrint.data.matchesPosted : "—"}
          hint="loans carry a ciphertext of their size, never a number"
        />
      </div>

      {/* The collateral schedule, then listing #0's mark beside the underlying equity feed. */}
      <CollateralSchedule />
      <CollateralMark />
      <LiveEvents />
      {dep.data && !dep.data.faucet && config.cluster === "devnet" && (
        <p className="text-xs text-ink-3">
          Reading the chain directly — the admin service is not reachable from this browser, which only matters for the
          faucet on the Desk.
        </p>
      )}
    </div>
  );
}

function Tile({ n, label, value, hint }: { n: string; label: string; value: number | string; hint: string }) {
  return (
    <a
      href="#/explorer"
      className="group rounded-[var(--radius-lg)] border border-line bg-surface-1 px-5 py-4 transition-colors hover:border-line-strong"
    >
      <div className="flex items-center justify-between">
        <span className="mono text-[11px] uppercase tracking-[0.14em] text-ink-3">{label}</span>
        <span className="mono text-[11px] text-ink-3 group-hover:text-accent">{n}</span>
      </div>
      <div className="mt-1 text-2xl font-semibold text-ink-1">{value}</div>
      <div className="mt-1 text-xs text-ink-3">{hint}</div>
    </a>
  );
}

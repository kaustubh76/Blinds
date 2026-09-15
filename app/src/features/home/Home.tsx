/** Home: the benchmark (xONIA = last printed r*), the epoch clock, the series, the last curve. */
import { cumulative, depthFromPrint, EpochStatus, PrintStatus } from "@thewindow/solana-sdk";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Badge, Panel, Stat } from "../../components/ui";
import { formatBps, formatCountdown, formatPrice, formatRate, formatUsdc, slotsToSeconds } from "../../lib/format";
import {
  useAuctionConfig,
  useDeployment,
  useEpoch,
  useMultiplier,
  useOracle,
  usePrice,
  usePrint,
  useSeries,
  useSlot,
} from "../../lib/queries";
import { DepthChart } from "../explorer/DepthChart";

export function Home() {
  const dep = useDeployment();
  const cfg = useAuctionConfig();
  const oracle = useOracle();
  const slot = useSlot();
  const current = cfg.data?.hasOpenEpoch ? cfg.data.currentEpoch : null;
  const epoch = useEpoch(current);
  const lastPrinted = oracle.data?.hasPrinted ? oracle.data.lastPrintEpoch : null;
  const series = useSeries(cfg.data ? cfg.data.currentEpoch : null);
  const lastPrint = usePrint(lastPrinted);
  const price = usePrice(dep.data?.feedId);
  const mult = useMultiplier(dep.data?.mockMint);

  const closeSlot = epoch.data && cfg.data ? Number(epoch.data.startSlot + cfg.data.epochSlots) : null;
  const remaining = closeSlot !== null && slot.data !== undefined ? closeSlot - slot.data : null;
  const regime = oracle.data;
  const xonia = regime?.hasPrinted && regime.lastRStarTick !== 255 ? regime.lastRStarTick : null;

  const points = (series.data ?? []).map((s) => ({
    epoch: Number(s.epoch),
    rate: s.print.status === PrintStatus.Printed ? Number(s.print.rStarTick) * 25 + 100 : null,
    matched: Number(s.print.matchedVolume) / 1e6,
  }));
  const lastCurve = lastPrint.data ? depthFromPrint(lastPrint.data) : null;

  return (
    <div className="grid gap-4 lg:grid-cols-3">
      <Panel title="xONIA · overnight rate on tokenized stock">
        <Stat
          label="last print"
          value={xonia !== null ? formatRate(xonia) : "—"}
          hint={
            regime?.hasPrinted ? (
              <>
                epoch {regime.lastPrintEpoch.toString()} · {xonia !== null ? formatBps(xonia) : "no trade"} ·{" "}
                {formatUsdc(regime.lastMatched)} matched
              </>
            ) : (
              "no print yet"
            )
          }
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {regime && (
            <>
              <Badge tone={regime.stale ? "warn" : "good"}>{regime.stale ? `stale · τ=${regime.tau}` : "live"}</Badge>
              <Badge>{regime.consecutiveTrades} consecutive trades</Badge>
              {regime.bandEdge ? <Badge tone="warn">band edge</Badge> : null}
              <Badge>{regime.prints.toString()} prints</Badge>
            </>
          )}
        </div>
      </Panel>
      <Panel title="epoch clock">
        {epoch.data && cfg.data ? (
          <>
            <Stat
              label={`epoch ${epoch.data.index.toString()} · ${epoch.data.status === EpochStatus.Open ? "open" : "closed"}`}
              value={
                remaining !== null ? (remaining > 0 ? formatCountdown(slotsToSeconds(remaining)) : "closing…") : "—"
              }
              hint={`${epoch.data.totalBids} bids · closes at slot ${closeSlot} · now ${slot.data ?? "…"}`}
            />
            <p className="mt-3 text-xs text-mute">
              Bids are submitted as ciphertexts and accumulated on-chain; the administrator prints the aggregate per
              tick with a proof of correct decryption after the window closes.
            </p>
          </>
        ) : (
          <p className="text-sm text-mute">{cfg.isLoading ? "loading…" : "no open epoch"}</p>
        )}
      </Panel>
      <Panel title="collateral reference">
        {price.data && dep.data ? (
          <Stat
            label="mock xStock · posted price"
            value={formatPrice(price.data.price, price.data.expo)}
            hint={
              <>
                slot {price.data.postedSlot.toString()} · multiplier {mult.data?.multiplier.toFixed(4) ?? "…"} · haircut
                150%
              </>
            }
          />
        ) : (
          <p className="text-sm text-mute">{dep.isError ? "admin service unreachable" : "loading…"}</p>
        )}
      </Panel>
      <div className="lg:col-span-2">
        <Panel title="xONIA series">
          <div className="h-64">
            <ResponsiveContainer>
              <LineChart data={points}>
                <CartesianGrid stroke="#1f2a37" />
                <XAxis dataKey="epoch" stroke="#8b98a8" fontSize={11} />
                <YAxis stroke="#8b98a8" fontSize={11} unit=" bps" domain={[100, 1000]} />
                <Tooltip contentStyle={{ background: "#121821", border: "1px solid #1f2a37" }} />
                <Line
                  type="stepAfter"
                  dataKey="rate"
                  stroke="#7dd3fc"
                  dot={false}
                  connectNulls={false}
                  name="r* (bps)"
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Panel>
      </div>
      <Panel title={lastPrinted !== null ? `last curve · epoch ${lastPrinted.toString()}` : "last curve"}>
        {lastCurve ? (
          <DepthChart curve={cumulative(lastCurve.curve)} rStar={lastCurve.clearing?.rStar ?? null} />
        ) : (
          <p className="text-sm text-mute">no print yet</p>
        )}
      </Panel>
    </div>
  );
}

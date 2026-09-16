/**
 * Cumulative supply S(r) and demand D(r) across the 37 ticks, with the clearing rate marked. Two
 * series, so a legend is always present; the fills are a wash, the lines carry the data.
 */
import type { CurvePoint } from "@thewindow/solana-sdk";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { chartTheme } from "../../lib/theme";

const k = (v: number) => (v >= 1000 ? `${+(v / 1000).toFixed(1)}k` : `${Math.round(v)}`);

export function DepthChart({
  curve,
  rStar,
  height = 220,
}: {
  curve: CurvePoint[];
  rStar: number | null;
  height?: number;
}) {
  const t = chartTheme();
  const data = curve.map((p) => ({ bps: p.bps, supply: Number(p.supply) / 1e6, demand: Number(p.demand) / 1e6 }));
  // Clean ticks: a nice ceiling with headroom for the legend, split in four.
  const peak = Math.max(1, ...data.map((d) => Math.max(d.supply, d.demand)));
  const step = 10 ** Math.floor(Math.log10(peak * 1.3));
  const top = Math.ceil((peak * 1.3) / step) * step;
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(top * f));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke={t.line} />
          <XAxis
            dataKey="bps"
            tickLine={false}
            axisLine={{ stroke: t.lineStrong }}
            tickFormatter={(v: number) => `${v / 100}%`}
            minTickGap={28}
          />
          <YAxis tickLine={false} axisLine={false} width={44} tickFormatter={k} domain={[0, top]} ticks={ticks} />
          <Tooltip
            cursor={{ stroke: t.lineStrong, strokeWidth: 1 }}
            content={({ active, payload, label }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !p) return null;
              return (
                <div className="rounded-[var(--radius-md)] border border-line bg-surface-1 px-3 py-2 text-xs">
                  <div className="mono mb-1 text-ink-3">at {(Number(label) / 100).toFixed(2)}%</div>
                  <div className="flex items-center gap-2 text-ink-1">
                    <span className="inline-block h-0.5 w-3" style={{ background: t.lend }} />
                    <span className="num font-semibold">{p.supply.toLocaleString("en-US")}</span>
                    <span className="text-ink-2">USDC offered</span>
                  </div>
                  <div className="flex items-center gap-2 text-ink-1">
                    <span className="inline-block h-0.5 w-3" style={{ background: t.borrow }} />
                    <span className="num font-semibold">{p.demand.toLocaleString("en-US")}</span>
                    <span className="text-ink-2">USDC sought</span>
                  </div>
                </div>
              );
            }}
          />
          <Legend
            verticalAlign="top"
            align="left"
            iconType="plainline"
            height={28}
            wrapperStyle={{ paddingBottom: 6 }}
          />
          <Area
            type="stepAfter"
            dataKey="supply"
            name="S(r) · lend"
            stroke={t.lend}
            strokeWidth={2}
            fill={t.lend}
            fillOpacity={0.1}
            isAnimationActive={false}
          />
          <Area
            type="stepBefore"
            dataKey="demand"
            name="D(r) · borrow"
            stroke={t.borrow}
            strokeWidth={2}
            fill={t.borrow}
            fillOpacity={0.1}
            isAnimationActive={false}
          />
          {rStar !== null && (
            <ReferenceLine
              x={rStar * 25 + 100}
              stroke={t.accent}
              strokeWidth={1.5}
              label={{ value: "r*", fill: t.accent, fontSize: 11, position: "top" }}
            />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

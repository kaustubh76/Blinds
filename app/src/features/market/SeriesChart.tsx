/**
 * xONIA by epoch. One series (the rate), so no legend box; the endpoint carries the only direct
 * label, and it costs 56px of right margin. On a phone that is a fifth of the plot for a figure the
 * page already shows at 56px directly above this chart, so there the label goes and the plot wins.
 * NoTrade epochs are gaps in the line and hollow markers on the baseline so they are seen, not
 * smoothed over. Crosshair tooltip lists rate, matched volume and epoch.
 */
import { CartesianGrid, Line, LineChart, ReferenceDot, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { formatUsdc } from "../../lib/format";
import { useChartTheme } from "../../lib/theme";
import { BELOW_SM, useMediaQuery } from "../../lib/useMediaQuery";

export interface SeriesPoint {
  epoch: number;
  /** bps, or null for a NoTrade print */
  bps: number | null;
  matched: bigint;
}

export function SeriesChart({ points, height = 240 }: { points: SeriesPoint[]; height?: number }) {
  const t = useChartTheme();
  const compact = useMediaQuery(BELOW_SM);
  const data = points.map((p) => ({ epoch: p.epoch, bps: p.bps, matched: Number(p.matched) / 1e6 }));
  const traded = data.filter((d) => d.bps !== null);
  const last = traded[traded.length - 1];
  const values = traded.map((d) => d.bps as number);
  const lo = values.length ? Math.floor((Math.min(...values) - 50) / 100) * 100 : 100;
  const hi = values.length ? Math.ceil((Math.max(...values) + 50) / 100) * 100 : 1000;
  const floor = Math.max(100, lo);
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 20, right: compact ? 10 : 56, bottom: 4, left: 0 }}>
          <CartesianGrid vertical={false} stroke={t.line} />
          <XAxis dataKey="epoch" tickLine={false} axisLine={{ stroke: t.lineStrong }} minTickGap={24} />
          <YAxis
            domain={[floor, hi]}
            tickLine={false}
            axisLine={false}
            width={compact ? 42 : 52}
            tickMargin={4}
            tickFormatter={(v: number) => `${(v / 100).toFixed(2)}%`}
          />
          <Tooltip
            cursor={{ stroke: t.lineStrong, strokeWidth: 1 }}
            content={({ active, payload }) => {
              const p = payload?.[0]?.payload as (typeof data)[number] | undefined;
              if (!active || !p) return null;
              return (
                <div className="rounded-[var(--radius-md)] border border-line bg-surface-1 px-3 py-2 text-xs shadow-none">
                  <div className="text-sm font-semibold text-ink-1">
                    {p.bps === null ? "no trade" : `${(p.bps / 100).toFixed(2)}%`}
                  </div>
                  <div className="text-ink-2">{formatUsdc(BigInt(Math.round(p.matched * 1e6)))} matched</div>
                  <div className="mono text-ink-3">epoch {p.epoch}</div>
                </div>
              );
            }}
          />
          <Line
            type="stepAfter"
            dataKey="bps"
            stroke={t.accent}
            strokeWidth={2}
            dot={false}
            connectNulls={false}
            isAnimationActive={false}
            activeDot={{ r: 5, fill: t.accent, stroke: t.surface, strokeWidth: 2 }}
          />
          {data
            .filter((d) => d.bps === null)
            .map((d) => (
              <ReferenceDot
                key={d.epoch}
                x={d.epoch}
                y={floor}
                r={4}
                fill={t.surface}
                stroke={t.ink3}
                strokeWidth={1.5}
              />
            ))}
          {last && (
            <ReferenceDot
              x={last.epoch}
              y={last.bps as number}
              r={5}
              fill={t.accent}
              stroke={t.surface}
              strokeWidth={2}
              {...(compact
                ? {}
                : {
                    label: {
                      value: `${((last.bps as number) / 100).toFixed(2)}%`,
                      position: "right" as const,
                      fill: t.ink1,
                      fontSize: 12,
                    },
                  })}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

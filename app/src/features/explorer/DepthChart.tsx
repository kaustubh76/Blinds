/** Cumulative supply S(r) and demand D(r) across the 37 ticks with the clearing rate marked. */
import type { CurvePoint } from "@thewindow/solana-sdk";
import { Area, AreaChart, CartesianGrid, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

export function DepthChart({ curve, rStar }: { curve: CurvePoint[]; rStar: number | null }) {
  const data = curve.map((p) => ({ bps: p.bps, supply: Number(p.supply) / 1e6, demand: Number(p.demand) / 1e6 }));
  return (
    <div className="h-56">
      <ResponsiveContainer>
        <AreaChart data={data}>
          <CartesianGrid stroke="#1f2a37" />
          <XAxis dataKey="bps" stroke="#8b98a8" fontSize={11} unit=" bps" />
          <YAxis stroke="#8b98a8" fontSize={11} tickFormatter={(v: number) => `${Math.round(v / 1000)}k`} />
          <Tooltip
            contentStyle={{ background: "#121821", border: "1px solid #1f2a37" }}
            formatter={(v) => `${Number(v ?? 0).toLocaleString("en-US")} USDC`}
          />
          <Area type="stepAfter" dataKey="supply" name="S(r) lend" stroke="#4ade80" fill="#4ade8022" />
          <Area type="stepBefore" dataKey="demand" name="D(r) borrow" stroke="#f87171" fill="#f8717122" />
          {rStar !== null && (
            <ReferenceLine x={rStar * 25 + 100} stroke="#7dd3fc" label={{ value: "r*", fill: "#7dd3fc" }} />
          )}
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

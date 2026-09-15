/** Tick grid and cumulative curves (spec v2 §7.1, §7.3). Mirrors `window-clearing`. */
export const TICKS = 37;
export const MIN_BPS = 100;
export const TICK_BPS = 25;

export type Tick = number;
export type Bps = number;
export type MicroUsdc = bigint;

export function tickToBps(tick: Tick): Bps {
  if (!Number.isInteger(tick) || tick < 0 || tick >= TICKS) throw new RangeError(`tick ${tick}`);
  return MIN_BPS + TICK_BPS * tick;
}
export function bpsToTick(bps: Bps): Tick {
  const t = Math.round((bps - MIN_BPS) / TICK_BPS);
  if (t < 0 || t >= TICKS) throw new RangeError(`bps ${bps}`);
  return t;
}
export function formatRate(tick: Tick): string {
  return `${(tickToBps(tick) / 100).toFixed(2)}%`;
}

export interface DepthCurve {
  ask: MicroUsdc[]; // length TICKS
  bid: MicroUsdc[];
}
export interface CurvePoint {
  tick: Tick;
  bps: Bps;
  supply: MicroUsdc; // S(r) = Σ_{t≤r} ask
  demand: MicroUsdc; // D(r) = Σ_{t≥r} bid
}
export interface Clearing {
  rStar: Tick;
  matched: MicroUsdc;
  marginalTick: Tick;
  marginalRatio: { num: bigint; den: bigint };
}

export function emptyCurve(): DepthCurve {
  return { ask: Array<bigint>(TICKS).fill(0n), bid: Array<bigint>(TICKS).fill(0n) };
}

export function cumulative(c: DepthCurve): CurvePoint[] {
  const out: CurvePoint[] = [];
  const demand = Array<bigint>(TICKS).fill(0n);
  let d = 0n;
  for (let t = TICKS - 1; t >= 0; t--) {
    d += c.bid[t] ?? 0n;
    demand[t] = d;
  }
  let s = 0n;
  for (let t = 0; t < TICKS; t++) {
    s += c.ask[t] ?? 0n;
    out.push({ tick: t, bps: tickToBps(t), supply: s, demand: demand[t] ?? 0n });
  }
  return out;
}

/** §7.3: r* = min{ r : S(r) ≥ D(r) > 0 }; matched = D(r*); price-priority allocation of supply. */
export function clear(c: DepthCurve): Clearing | null {
  const curve = cumulative(c);
  for (const p of curve) {
    if (p.demand > 0n && p.supply >= p.demand) {
      const needed = p.demand;
      let m = 0;
      let below = 0n;
      for (let i = 0; i <= p.tick; i++) {
        const s = curve[i]?.supply ?? 0n;
        if (s >= needed) {
          m = i;
          break;
        }
        below = s;
      }
      const atTick = c.ask[m] ?? 0n;
      const take = needed - below;
      const marginalRatio = atTick === 0n || take >= atTick ? { num: 1n, den: 1n } : { num: take, den: atTick };
      return { rStar: p.tick, matched: needed, marginalTick: m, marginalRatio };
    }
  }
  return null;
}

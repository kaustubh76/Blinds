/**
 * The backdrop's simulation, as pure arithmetic.
 *
 * A mote is one sealed bid. While a window is open they rise and accumulate — the field is denser
 * when more bids are in. While the print is proven they converge onto the clearing line; when it
 * lands the line stamps and the field is released. Nothing here touches the DOM, a canvas or React,
 * so the whole behaviour is testable the way `derivePhase` in `useWindowClock.ts` is.
 *
 * Coordinates are normalised to 0–1 on both axes, so a resize never scrambles the field; the canvas
 * multiplies by its own pixel size when it paints. Velocities are per second, in the same units.
 */
import type { Phase } from "./useWindowClock";

export type PulseKind = "bid" | "print" | "event";

export interface Mote {
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** Seconds since this mote entered the field; the canvas fades it in over the first second. */
  age: number;
  /** Stable 0–1 per mote, so size and wander vary without a random call per frame. */
  seed: number;
}

export interface Pulse {
  kind: PulseKind;
  /** Counts 1 → 0 and is then dropped. */
  life: number;
  x: number;
  y: number;
}

export interface FieldState {
  motes: Mote[];
  /** 0–1: how strongly the clearing line is drawn. */
  line: number;
  /** 0–1: the print stamp, which ramps to 1 while printed and decays after. */
  stamp: number;
  pulses: Pulse[];
  /**
   * 0–1: a brief lift over the whole field when something happens. An expanding ring alone is a
   * thousand pixels on a million-pixel canvas — it is not seen. This is what makes a pulse land.
   */
  flash: number;
  /** Advances only as fast as the field moves, so a stalled field is genuinely still. */
  clock: number;
}

/** Where the motes converge, and where the clearing line is drawn. */
export const LINE_Y = 0.52;

const MIN_MOTES = 24;
const MAX_MOTES = 90;
/** One mote per this many CSS pixels of viewport, before the bid density is applied. */
const PX_PER_MOTE = 26_000;
/** The sealed-bid count at which the field reaches full density. */
const BIDS_FOR_FULL = 24;
const PULSE_SECONDS = 1.1;
/** How fast the flash fades, per second. Fast enough to be a moment, not a mode. */
const FLASH_DECAY = 1.9;
/** How hard each kind of pulse hits. A print is the market's own moment; a bid is one of many. */
const FLASH_BY_KIND: Record<PulseKind, number> = { print: 1, bid: 0.6, event: 0.4 };
/** Motes added or removed per step, so a change in density is never abrupt. */
const GROW_PER_STEP = 3;

/** How fast the field moves in each phase, as a multiple of its base drift. */
const DRIFT: Record<Phase, number> = {
  loading: 0.12,
  open: 1,
  overdue: 0.14,
  closed: 0.06,
  stalled: 0.05,
  printing: 0.5,
  printed: 0.7,
  notrade: 0.55,
  idle: 0.18,
};

/** A small deterministic generator: the same seed always yields the same field. */
export function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s >>>= 0;
    return s / 0x1_0000_0000;
  };
}

/** How many motes a viewport of `area` CSS pixels carries with `bids` sealed. */
export function targetCount(area: number, bids: number): number {
  const byArea = Math.round(area / PX_PER_MOTE);
  const capped = Math.min(MAX_MOTES, Math.max(MIN_MOTES, byArea));
  const density = 0.45 + 0.55 * Math.min(1, Math.max(0, bids) / BIDS_FOR_FULL);
  return Math.max(MIN_MOTES, Math.round(capped * density));
}

export function createField(): FieldState {
  return { motes: [], line: 0, stamp: 0, pulses: [], flash: 0, clock: 0 };
}

function spawn(next: () => number): Mote {
  return { x: next(), y: next(), vx: 0, vy: 0, age: 0, seed: next() };
}

export interface FieldInput {
  phase: Phase;
  /** 0–1 through the open window. Drawn as a sweep; it does not move the motes. */
  progress: number;
  bids: number;
  /** Viewport size in CSS pixels; only the area and the aspect are used. */
  w: number;
  h: number;
  /** Pulse kinds pushed since the last step. */
  incoming: readonly PulseKind[];
  /** A deterministic source, so a test can pin the field. */
  next: () => number;
}

/**
 * One step. `dtMs` is clamped: a tab that was backgrounded hands back a delta of many seconds, and
 * the field should resume where it was rather than teleport.
 */
export function stepField(state: FieldState, input: FieldInput, dtMs: number): FieldState {
  const dt = Math.min(0.1, Math.max(0, dtMs / 1000));
  const { phase, next } = input;
  const drift = DRIFT[phase] ?? 0.2;
  // A wide viewport should not appear to drift faster sideways than a narrow one.
  const xScale = input.h > 0 ? 1 / Math.min(2, Math.max(1, input.w / input.h)) : 1;

  const target = targetCount(Math.max(1, input.w * input.h), input.bids);
  const motes = state.motes.slice();
  if (motes.length < target) {
    const add = Math.min(GROW_PER_STEP, target - motes.length);
    for (let i = 0; i < add; i++) motes.push(spawn(next));
  } else if (motes.length > target) {
    motes.length = Math.max(target, motes.length - GROW_PER_STEP);
  }

  const converging = phase === "printing" || phase === "printed";
  const dispersing = phase === "notrade";
  const rising = phase === "open" || phase === "overdue" || phase === "idle" || phase === "loading";

  const nextMotes: Mote[] = [];
  for (const m of motes) {
    let vx = m.vx;
    let vy = m.vy;
    // A slow wander, deterministic per mote, so the field never reads as a uniform scroll.
    const t = state.clock + m.seed * 100;
    vx += Math.sin(t * 0.7 + m.seed * 6.3) * 0.05 * dt;
    vy += Math.cos(t * 0.5 + m.seed * 4.1) * 0.04 * dt;
    // Sealed bids rise while the window takes them.
    if (rising) vy -= 0.06 * dt;
    if (converging) {
      vy += (LINE_Y - m.y) * 1.8 * dt;
      vx += (0.5 - m.x) * 0.3 * dt;
    }
    if (dispersing) vy += (m.y - LINE_Y) * 1.0 * dt;

    // Damping bounds the velocities without a clamp, which would read as a wall.
    const damp = 1 - Math.min(0.9, 1.6 * dt);
    vx *= damp;
    vy *= damp;

    let x = m.x + vx * drift * xScale * dt;
    let y = m.y + vy * drift * dt;

    // The field wraps rather than ends: a mote that leaves re-enters as a new sealed bid.
    if (y < -0.05) {
      y = 1.05;
      x = next();
    } else if (y > 1.05) {
      y = -0.05;
    }
    if (x < -0.05) x = 1.05;
    else if (x > 1.05) x = -0.05;

    nextMotes.push({ x, y, vx, vy, age: m.age + dt, seed: m.seed });
  }

  // The line is faint while a window is open, firm while the print is made, and fades after.
  const lineTarget = phase === "printing" ? 0.55 : phase === "printed" ? 1 : phase === "open" ? 0.12 : 0;
  const line = state.line + (lineTarget - state.line) * Math.min(1, 3 * dt);
  const stamp = phase === "printed" ? Math.min(1, state.stamp + dt * 2.5) : Math.max(0, state.stamp - dt * 0.8);

  const pulses: Pulse[] = [];
  for (const p of state.pulses) {
    const life = p.life - dt / PULSE_SECONDS;
    if (life > 0) pulses.push({ ...p, life });
  }
  let flash = Math.max(0, state.flash - dt * FLASH_DECAY);
  for (const kind of input.incoming) {
    // A print pulses from the clearing line; anything else from where it happened to land.
    pulses.push({ kind, life: 1, x: kind === "print" ? 0.5 : next(), y: kind === "print" ? LINE_Y : next() });
    flash = Math.max(flash, FLASH_BY_KIND[kind] ?? 0.4);
  }

  return { motes: nextMotes, line, stamp, pulses: pulses.slice(-12), flash, clock: state.clock + dt * drift };
}

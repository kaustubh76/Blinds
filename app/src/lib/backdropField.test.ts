import { describe, expect, it } from "vitest";
import {
  createField,
  type FieldInput,
  type FieldState,
  LINE_Y,
  type PulseKind,
  rng,
  stepField,
  targetCount,
} from "./backdropField";
import type { Phase } from "./useWindowClock";

const PHONE = { w: 390, h: 844 };
const DESKTOP = { w: 1920, h: 1080 };

function input(over: Partial<FieldInput> = {}): FieldInput {
  return { phase: "open", progress: 0, bids: 0, ...PHONE, incoming: [], next: rng(7), ...over };
}

/** Runs the field to a steady state so a test reads behaviour rather than the first frame. */
function run(over: Partial<FieldInput> = {}, steps = 400, from: FieldState = createField()): FieldState {
  const next = over.next ?? rng(7);
  let s = from;
  for (let i = 0; i < steps; i++) s = stepField(s, input({ ...over, next }), 16);
  return s;
}

describe("targetCount", () => {
  it("never drops below the floor, however small the viewport", () => {
    expect(targetCount(1, 0)).toBe(24);
    expect(targetCount(PHONE.w * PHONE.h, 0)).toBe(24);
  });

  it("is capped, however large the viewport", () => {
    expect(targetCount(10_000 * 10_000, 1000)).toBe(90);
  });

  it("rises with the sealed-bid count and then stops", () => {
    const area = DESKTOP.w * DESKTOP.h;
    const none = targetCount(area, 0);
    const some = targetCount(area, 8);
    const full = targetCount(area, 24);
    expect(some).toBeGreaterThan(none);
    expect(full).toBeGreaterThan(some);
    expect(targetCount(area, 500)).toBe(full);
  });

  it("treats a negative bid count as none", () => {
    expect(targetCount(DESKTOP.w * DESKTOP.h, -5)).toBe(targetCount(DESKTOP.w * DESKTOP.h, 0));
  });
});

describe("stepField", () => {
  it("grows the field toward its target and holds there", () => {
    const s = run({ ...DESKTOP, bids: 24 });
    expect(s.motes).toHaveLength(targetCount(DESKTOP.w * DESKTOP.h, 24));
  });

  it("shrinks when the bid count falls", () => {
    const full = run({ ...DESKTOP, bids: 24 });
    const thinned = run({ ...DESKTOP, bids: 0 }, 400, full);
    expect(thinned.motes.length).toBe(targetCount(DESKTOP.w * DESKTOP.h, 0));
    expect(thinned.motes.length).toBeLessThan(full.motes.length);
  });

  it("keeps every mote inside the wrapped field", () => {
    for (const phase of ["open", "printing", "printed", "notrade", "idle"] as Phase[]) {
      const s = run({ phase, bids: 12 });
      for (const m of s.motes) {
        expect(m.x).toBeGreaterThanOrEqual(-0.06);
        expect(m.x).toBeLessThanOrEqual(1.06);
        expect(m.y).toBeGreaterThanOrEqual(-0.06);
        expect(m.y).toBeLessThanOrEqual(1.06);
        expect(Number.isFinite(m.vx)).toBe(true);
        expect(Number.isFinite(m.vy)).toBe(true);
      }
    }
  });

  it("converges the motes onto the clearing line while the print is proven", () => {
    const open = run({ phase: "open", bids: 12 });
    const spread = (s: FieldState) =>
      s.motes.reduce((acc, m) => acc + Math.abs(m.y - LINE_Y), 0) / Math.max(1, s.motes.length);
    const printing = run({ phase: "printing", bids: 12 }, 400, open);
    expect(spread(printing)).toBeLessThan(spread(open));
  });

  it("draws the line firmly only once the print has landed", () => {
    expect(run({ phase: "idle" }).line).toBeLessThan(0.05);
    expect(run({ phase: "open" }).line).toBeCloseTo(0.12, 1);
    expect(run({ phase: "printed" }).line).toBeGreaterThan(0.9);
  });

  it("ramps the stamp while printed and decays it after", () => {
    const printed = run({ phase: "printed" }, 120);
    expect(printed.stamp).toBeCloseTo(1, 2);
    const after = run({ phase: "idle" }, 400, printed);
    expect(after.stamp).toBe(0);
  });

  it("holds a pulse briefly and then drops it", () => {
    const one = stepField(createField(), input({ incoming: ["bid"] }), 16);
    expect(one.pulses).toHaveLength(1);
    expect(one.pulses[0]?.kind).toBe("bid");
    const gone = run({}, 200, one);
    expect(gone.pulses).toHaveLength(0);
  });

  it("puts a print pulse on the clearing line", () => {
    const s = stepField(createField(), input({ incoming: ["print"] }), 16);
    expect(s.pulses[0]?.y).toBe(LINE_Y);
    expect(s.pulses[0]?.x).toBe(0.5);
  });

  it("lifts the whole field on a pulse, hardest for a print", () => {
    const base = createField();
    expect(base.flash).toBe(0);
    const print = stepField(base, input({ incoming: ["print"] }), 16);
    const bid = stepField(base, input({ incoming: ["bid"] }), 16);
    const event = stepField(base, input({ incoming: ["event"] }), 16);
    expect(print.flash).toBe(1);
    expect(bid.flash).toBeLessThan(print.flash);
    expect(event.flash).toBeLessThan(bid.flash);
    expect(event.flash).toBeGreaterThan(0);
  });

  it("fades the flash back to nothing within about a second", () => {
    const lit = stepField(createField(), input({ incoming: ["print"] }), 16);
    const half = run({}, 20, lit);
    expect(half.flash).toBeLessThan(lit.flash);
    expect(run({}, 120, lit).flash).toBe(0);
  });

  it("does not stack a second pulse above full", () => {
    const one = stepField(createField(), input({ incoming: ["print"] }), 16);
    const two = stepField(one, input({ incoming: ["print", "print"] }), 16);
    expect(two.flash).toBe(1);
  });

  it("never accumulates pulses without bound", () => {
    const many: PulseKind[] = Array.from({ length: 40 }, () => "event");
    const s = stepField(createField(), input({ incoming: many }), 16);
    expect(s.pulses.length).toBeLessThanOrEqual(12);
  });

  it("survives the huge delta a backgrounded tab hands back", () => {
    const warm = run({ bids: 12 });
    const after = stepField(warm, input({ bids: 12 }), 30 * 60 * 1000);
    expect(after.motes).toHaveLength(warm.motes.length);
    for (const m of after.motes) {
      expect(Number.isFinite(m.x)).toBe(true);
      expect(Number.isFinite(m.y)).toBe(true);
    }
  });

  it("ignores a zero or negative delta rather than running backwards", () => {
    const warm = run({ bids: 12 });
    const same = stepField(warm, input({ bids: 12 }), -100);
    expect(same.clock).toBe(warm.clock);
  });

  it("advances its clock more slowly when the keeper is late than when the window is open", () => {
    expect(run({ phase: "overdue" }, 100).clock).toBeLessThan(run({ phase: "open" }, 100).clock);
  });

  it("is deterministic for a given seed", () => {
    const a = run({ bids: 10, next: rng(42) });
    const b = run({ bids: 10, next: rng(42) });
    expect(a.motes).toEqual(b.motes);
  });
});

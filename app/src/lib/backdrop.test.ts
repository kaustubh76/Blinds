import { beforeEach, describe, expect, it } from "vitest";
import { type BackdropInput, backdrop } from "./backdrop";

const input = (over: Partial<BackdropInput> = {}): BackdropInput => ({
  phase: "open",
  progress: 0.5,
  bids: 4,
  connected: true,
  ...over,
});

describe("the backdrop store", () => {
  beforeEach(() => {
    backdrop.drain();
    backdrop.setInput(input({ phase: "loading", progress: 0, bids: 0, connected: false }));
  });

  it("hands over the pulses since the last frame, then forgets them", () => {
    backdrop.setEnabled(true);
    backdrop.pulse("bid");
    backdrop.pulse("print");
    expect([...backdrop.drain()]).toEqual(["bid", "print"]);
    expect(backdrop.drain()).toHaveLength(0);
  });

  // A burst of chain events must not grow without bound between frames; nobody sees the extra rings.
  it("caps a burst", () => {
    backdrop.setEnabled(true);
    for (let i = 0; i < 100; i++) backdrop.pulse("event");
    expect(backdrop.drain().length).toBeLessThanOrEqual(16);
  });

  it("draining pulses leaves the input alone", () => {
    backdrop.setEnabled(true);
    backdrop.setInput(input({ bids: 9 }));
    backdrop.pulse("bid");
    backdrop.drain();
    expect(backdrop.read().bids).toBe(9);
  });

  // `setInput` is on the hot path — the clock ticks a few times a second — so an unchanged input
  // must be rejected outright. A rejected write leaves the very same object in place.
  it("rejects a write that changed nothing", () => {
    backdrop.setInput(input());
    const held = backdrop.read();
    backdrop.setInput(input());
    expect(backdrop.read()).toBe(held);
  });

  it("rejects a progress nudge below the noise floor, and takes a real one", () => {
    backdrop.setInput(input({ progress: 0.5 }));
    const held = backdrop.read();
    backdrop.setInput(input({ progress: 0.5005 }));
    expect(backdrop.read()).toBe(held);
    backdrop.setInput(input({ progress: 0.9 }));
    expect(backdrop.read()).not.toBe(held);
    expect(backdrop.read().progress).toBe(0.9);
  });

  it("takes every other field on its own", () => {
    backdrop.setInput(input({ phase: "open", bids: 4, connected: true }));
    for (const patch of [{ phase: "printed" as const }, { bids: 11 }, { connected: false }]) {
      const held = backdrop.read();
      backdrop.setInput({ ...held, ...patch });
      expect(backdrop.read()).not.toBe(held);
      expect(backdrop.read()).toMatchObject(patch);
    }
  });

  it("the preference round-trips, and setting it to what it already is does nothing", () => {
    const was = backdrop.isEnabled();
    backdrop.setEnabled(!was);
    expect(backdrop.isEnabled()).toBe(!was);
    backdrop.setEnabled(!was);
    expect(backdrop.isEnabled()).toBe(!was);
    backdrop.setEnabled(was);
    expect(backdrop.isEnabled()).toBe(was);
  });
});

/**
 * The backdrop's store: what the field is told, and what anyone can tell it.
 *
 * A module-level store, the same shape as the real-time layer in `useLive.ts` and the developer
 * console in `console.ts`. Not a context: `pulse` has to be callable from a mutation's `onSuccess`
 * and from the event callback in `useLive.ts`, neither of which is inside a provider's render tree,
 * and a provider above the `Suspense` in `App.tsx` would re-render every route on every pulse.
 *
 *     backdrop.pulse("print")   // the Explorer, when a print re-verifies in the browser
 *     backdrop.pulse("bid")     // the Desk, when a sealed bid lands
 *
 * A pulse never changes the phase. It is an impulse on top of whatever the market is already doing.
 *
 * `setInput` and `pulse` are the hot path — the clock ticks a few times a second and events land in
 * bursts — so neither does any React work: the canvas reads this store inside its own frame loop.
 * `useBackdrop()` exists for anything that wants to *read* what the backdrop is showing; the canvas
 * itself deliberately does not use it.
 */
import { useSyncExternalStore } from "react";
import type { PulseKind } from "./backdropField";
import { readPref, writePref } from "./prefs";
import type { Phase } from "./useWindowClock";

/** The per-browser preference key, shared with the toggle in Settings. */
export const BACKDROP_PREF = "backdrop";

export interface BackdropInput {
  phase: Phase;
  /** 0–1 through the open window. */
  progress: number;
  bids: number;
  /** False once the real-time layer has given up; the field dims rather than pretending. */
  connected: boolean;
}

const EMPTY: readonly PulseKind[] = [];
/** More pulses than this in one frame is a burst; the extra would not be seen anyway. */
const MAX_QUEUED = 16;

let input: BackdropInput = { phase: "loading", progress: 0, bids: 0, connected: false };
let queued: PulseKind[] = [];
let enabled = readPref(BACKDROP_PREF, true);

const inputListeners = new Set<() => void>();
const enabledListeners = new Set<() => void>();

export const backdrop = {
  /** Fed from the window clock. Identical input is a no-op, so a still market costs nothing. */
  setInput(next: BackdropInput): void {
    if (
      next.phase === input.phase &&
      next.bids === input.bids &&
      next.connected === input.connected &&
      Math.abs(next.progress - input.progress) < 0.002
    )
      return;
    input = next;
    for (const l of inputListeners) l();
  },
  /**
   * One impulse, drained by the next frame the canvas paints. Does no React work.
   *
   * Dropped outright while the backdrop is off: the frame loop is the only drainer, so the queue
   * would otherwise fill to its cap and then discharge every ring at once the moment someone ticks
   * the preference back on — which reads as a rendering fault, not as a market.
   */
  pulse(kind: PulseKind): void {
    if (!enabled || queued.length >= MAX_QUEUED) return;
    queued.push(kind);
  },
  /** Called by the canvas each frame: hands over the pulses since the last one. */
  drain(): readonly PulseKind[] {
    if (queued.length === 0) return EMPTY;
    const out = queued;
    queued = [];
    return out;
  },
  read(): BackdropInput {
    return input;
  },
  /** Whether this browser wants a backdrop at all. Reduced motion is asked separately. */
  isEnabled(): boolean {
    return enabled;
  },
  /** Takes effect at once — no reload, unlike the endpoint settings beside it. */
  setEnabled(v: boolean): void {
    if (v === enabled) return;
    enabled = v;
    writePref(BACKDROP_PREF, v);
    for (const l of enabledListeners) l();
  },
};

const subscribeInput = (l: () => void) => {
  inputListeners.add(l);
  return () => {
    inputListeners.delete(l);
  };
};
const subscribeEnabled = (l: () => void) => {
  enabledListeners.add(l);
  return () => {
    enabledListeners.delete(l);
  };
};

/** What the backdrop is currently being told. */
export function useBackdrop(): BackdropInput {
  return useSyncExternalStore(subscribeInput, backdrop.read, backdrop.read);
}

/** The preference alone, for the toggle in Settings and for the canvas's own mount test. */
export function useBackdropEnabled(): boolean {
  return useSyncExternalStore(subscribeEnabled, backdrop.isEnabled, () => false);
}

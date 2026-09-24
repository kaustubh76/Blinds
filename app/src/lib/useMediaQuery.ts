/**
 * A media query as React state.
 *
 * The app's breakpoints are Tailwind's and belong in class names; this is for the few places where a
 * decision cannot be expressed in CSS — recharts takes its margins and axis widths as props, so a
 * chart has to know in JavaScript whether it is on a phone.
 *
 * The `MediaQueryList` is created fresh on each call rather than cached: `window.matchMedia` is
 * cheap, the browser keeps a list alive while it has listeners, and a module-level cache would
 * outlive the stub a test installs.
 */
import { useCallback, useSyncExternalStore } from "react";

function list(query: string): MediaQueryList | null {
  if (typeof window === "undefined") return null;
  return window.matchMedia?.(query) ?? null;
}

/** `whenUnknown` is the answer before a DOM exists — pick the safe side of the question. */
export function useMediaQuery(query: string, whenUnknown = false): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      const mq = list(query);
      mq?.addEventListener?.("change", onChange);
      return () => mq?.removeEventListener?.("change", onChange);
    },
    [query],
  );
  const read = useCallback(() => list(query)?.matches ?? whenUnknown, [query, whenUnknown]);
  return useSyncExternalStore(subscribe, read, () => whenUnknown);
}

/** Tailwind's `sm` breakpoint, from the other side: true below 40rem. */
export const BELOW_SM = "(max-width: 39.99rem)";

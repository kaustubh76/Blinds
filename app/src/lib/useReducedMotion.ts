/**
 * Whether this page should animate at all.
 *
 * Three things can say no: the operating system's reduced-motion setting, a `?motion=off` link, and
 * the per-browser preference in Settings. The first two are answered here; the third is a pref, so
 * it lives with the others in `prefs.ts`. The URL form is read once per page load and is neither
 * persisted nor stripped from the address bar — the screenshot driver in `scripts/smoke/screens.mjs`
 * passes it so a drifting field never makes `docs/screens/*.png` churn. It is the same shape as the
 * `?theme=` override in `theme.ts`.
 */
import { useMediaQuery } from "./useMediaQuery";

const QUERY = "(prefers-reduced-motion: reduce)";

/** `?motion=off` for this page load. Read on every call because tests reassign the location. */
function motionOffInUrl(): boolean {
  try {
    if (typeof window === "undefined") return false;
    return new URLSearchParams(window.location.search).get("motion") === "off";
  } catch {
    return false;
  }
}

/** True when nothing on the page should move. */
export function useReducedMotion(): boolean {
  // Unknown means "do not move": the safe side of this particular question.
  const reduced = useMediaQuery(QUERY, true);
  return motionOffInUrl() || reduced;
}

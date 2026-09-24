/**
 * The chart bridge to the design tokens. recharts takes colours as props, so the tokens in
 * index.css are read from the root element once (memoised) — no component carries a hex.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

const cache = new Map<string, string>();

export type Theme = "light" | "dark" | "system";
export const THEME_KEY = "thewindow:theme";
const listeners = new Set<() => void>();
/** Set once the visitor picks a theme here, which retires the `?theme=` link for this page load. */
let chosenHere = false;

function readTheme(): Theme {
  try {
    // `?theme=light|dark` wins for this page load (demos, screenshots) — until the visitor uses the
    // header toggle, which must then be able to move it back. Without this the toggle worked once.
    if (!chosenHere) {
      const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("theme") : null;
      if (q === "light" || q === "dark") return q;
    }
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

/** Applies the theme to the root element; the token cache is dropped so charts re-read colours. */
export function applyTheme(t: Theme): void {
  if (typeof document === "undefined") return;
  if (t === "system") document.documentElement.removeAttribute("data-theme");
  else document.documentElement.setAttribute("data-theme", t);
  cache.clear();
  for (const l of listeners) l();
}

export function setTheme(t: Theme): void {
  chosenHere = true;
  try {
    if (t === "system") localStorage.removeItem(THEME_KEY);
    else localStorage.setItem(THEME_KEY, t);
  } catch {
    // per-browser convenience only
  }
  applyTheme(t);
}

/** The effective theme ("light" | "dark") after resolving "system". */
export function resolvedTheme(): "light" | "dark" {
  const t = readTheme();
  if (t !== "system") return t;
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  const mq = typeof window !== "undefined" ? window.matchMedia?.("(prefers-color-scheme: dark)") : null;
  // The system flipping theme changes every token, so the cache must go with it — `applyTheme` does
  // this for an explicit choice; without it here, `token()` kept serving the old theme's values.
  const onChange = () => {
    cache.clear();
    l();
  };
  mq?.addEventListener?.("change", onChange);
  return () => {
    listeners.delete(l);
    mq?.removeEventListener?.("change", onChange);
  };
};

/** The chosen theme and a toggle between light and dark (a first toggle leaves "system"). */
export function useTheme() {
  const theme = useSyncExternalStore(subscribe, readTheme, () => "system" as Theme);
  const resolved = useSyncExternalStore(subscribe, resolvedTheme, () => "light" as const);
  useEffect(() => applyTheme(readTheme()), []);
  const toggle = useCallback(() => setTheme(resolvedTheme() === "dark" ? "light" : "dark"), []);
  return { theme, resolved, setTheme, toggle };
}

export function token(name: string): string {
  const key = `--color-${name}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const v =
    typeof document === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(key).trim();
  if (v) cache.set(key, v);
  return v || "currentColor";
}

/**
 * The chart palette, re-read whenever the theme changes.
 *
 * `chartTheme()` alone is not enough in a route: `App` does not re-render on a theme change, so the
 * element it passes as `Shell`'s children is the same object and React bails out of the whole route
 * subtree — a chart would keep the previous theme's hexes until its next poll. Subscribing here
 * re-renders the chart itself, whatever its parents do.
 */
export function useChartTheme(): ReturnType<typeof chartTheme> {
  // The subscription is the point, not its value: it re-renders this chart on a theme change. By
  // then `applyTheme` has dropped the token cache, so `chartTheme()` reads what is now on screen.
  useSyncExternalStore(subscribe, resolvedTheme, () => "light" as const);
  return chartTheme();
}

export const chartTheme = () => ({
  surface: token("surface-1"),
  line: token("line"),
  lineStrong: token("line-strong"),
  ink1: token("ink-1"),
  ink2: token("ink-2"),
  ink3: token("ink-3"),
  accent: token("accent"),
  lend: token("lend"),
  borrow: token("borrow"),
});

/**
 * The chart bridge to the design tokens. recharts takes colours as props, so the tokens in
 * index.css are read from the root element once (memoised) — no component carries a hex.
 */
import { useCallback, useEffect, useSyncExternalStore } from "react";

const cache = new Map<string, string>();

export type Theme = "light" | "dark" | "system";
export const THEME_KEY = "thewindow:theme";
const listeners = new Set<() => void>();

function readTheme(): Theme {
  try {
    // `?theme=light|dark` wins for this page load (demos, screenshots).
    const q = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("theme") : null;
    if (q === "light" || q === "dark") return q;
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
  mq?.addEventListener?.("change", l);
  return () => {
    listeners.delete(l);
    mq?.removeEventListener?.("change", l);
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

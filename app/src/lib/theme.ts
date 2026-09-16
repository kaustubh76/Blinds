/**
 * The chart bridge to the design tokens. recharts takes colours as props, so the tokens in
 * index.css are read from the root element once (memoised) — no component carries a hex.
 */
const cache = new Map<string, string>();

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

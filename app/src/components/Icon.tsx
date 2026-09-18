/** Inline SVG glyphs. 1.5px strokes on a 16-unit grid; colour comes from `currentColor`. */
const PATHS: Record<string, string> = {
  lock: "M4 7V5a4 4 0 0 1 8 0v2M3.5 7h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z",
  unlock: "M4 7V5a4 4 0 0 1 7.6-1.7M3.5 7h9a1 1 0 0 1 1 1v5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z",
  check: "M3 8.5l3 3 7-7",
  x: "M4 4l8 8M12 4l-8 8",
  clock: "M8 4.5V8l2.5 1.5M8 14A6 6 0 1 0 8 2a6 6 0 0 0 0 12Z",
  arrowRight: "M3 8h10M9 4l4 4-4 4",
  chevronLeft: "M10 3L5 8l5 5",
  chevronRight: "M6 3l5 5-5 5",
  external: "M6 3H3v10h10v-3M9 3h4v4M13 3L7 9",
  shield: "M8 1.5l5 2v4c0 3-2.2 5.3-5 6.5C5.2 12.8 3 10.5 3 7.5v-4l5-2Z",
  key: "M9.5 6.5a3 3 0 1 0-2.8 2L3 12.2V14h1.8l.7-.7v-1.4h1.4l1-1h1.3l.8-.8a3 3 0 0 0-.5-3.6Z",
  spark: "M8 1.5l1.6 4.4 4.4 1.6-4.4 1.6L8 13.5 6.4 9.1 2 7.5l4.4-1.6L8 1.5Z",
  dot: "M8 8m-2 0a2 2 0 1 0 4 0a2 2 0 1 0-4 0",
  wallet: "M2 5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v1H2V5Zm0 1h12v6a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V6Zm8 3h2",
  refresh: "M13 8a5 5 0 1 1-1.5-3.6M13 3v2.5h-2.5",
  alert: "M8 2l6.5 11h-13L8 2Zm0 4v3.5M8 11.5v.5",
  gear: "M8 10.5a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm5-2.5-.1-1.3 1.3-1-1-1.8-1.5.5-1-.8-.3-1.6h-2l-.3 1.6-1 .8-1.5-.5-1 1.8 1.3 1L3 8l.1 1.3-1.3 1 1 1.8 1.5-.5 1 .8.3 1.6h2l.3-1.6 1-.8 1.5.5 1-1.8-1.3-1L13 8Z",
  terminal: "M2 3h12v10H2V3Zm2.5 2.5L7 8l-2.5 2.5M8 10.5h3.5",
  copy: "M6 6h7v7H6V6Zm-3 4V3h7",
  play: "M5 3l8 5-8 5V3Z",
  stop: "M4 4h8v8H4z",
  code: "M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5",
  sun: "M8 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6ZM8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M3.4 12.6l1.1-1.1M11.5 4.5l1.1-1.1",
  moon: "M13.5 9.5A5.5 5.5 0 0 1 6.5 2.5a5.5 5.5 0 1 0 7 7Z",
  home: "M2.5 7.5 8 3l5.5 4.5V13a.5.5 0 0 1-.5.5H9.5V10h-3v3.5H3a.5.5 0 0 1-.5-.5V7.5Z",
  layers: "M8 2.5 14 5.5 8 8.5 2 5.5 8 2.5ZM2 8.5l6 3 6-3M2 11.5l6 3 6-3",
  chart: "M2 13h12M4 10l3-3 2.5 2.5L13 5",
  search: "M7 12A5 5 0 1 0 7 2a5 5 0 0 0 0 10ZM10.5 10.5 14 14",
  menu: "M2.5 4.5h11M2.5 8h11M2.5 11.5h11",
  eyeOff:
    "M2 2l12 12M6.5 6.6A2 2 0 0 0 9.4 9.4M4.2 4.3C2.7 5.3 1.8 6.7 1.5 8c1 2.6 3.5 4.5 6.5 4.5 1.2 0 2.3-.3 3.3-.8M7.2 3.6c.3 0 .5-.1.8-.1 3 0 5.5 1.9 6.5 4.5-.3.8-.8 1.6-1.4 2.2",
  eye: "M1.5 8c1-2.6 3.5-4.5 6.5-4.5s5.5 1.9 6.5 4.5c-1 2.6-3.5 4.5-6.5 4.5S2.5 10.6 1.5 8Zm6.5 2a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z",
  zap: "M9 1.5 3 9h4.5L7 14.5 13 7H8.5L9 1.5Z",
  sparkles: "M4 2v3M2.5 3.5h3M12 10v3M10.5 11.5h3M8 4l1.2 3.3L12.5 8.5 9.2 9.7 8 13 6.8 9.7 3.5 8.5l3.3-1.2L8 4Z",
  users:
    "M6 8a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Zm5 0a2 2 0 1 0 0-4M1.5 13.5c.4-2.3 2.2-3.5 4.5-3.5s4.1 1.2 4.5 3.5M10.5 10.5c2 .1 3.5 1.2 4 3",
  calendar: "M2.5 4.5h11v9h-11v-9ZM2.5 7.5h11M5 2.5v3M11 2.5v3",
};

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 16, className = "" }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`inline-block shrink-0 ${className}`}
      aria-hidden="true"
    >
      <path d={PATHS[name]} />
    </svg>
  );
}

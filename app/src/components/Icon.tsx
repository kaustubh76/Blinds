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

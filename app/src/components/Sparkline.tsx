/** A 12-point inline sparkline: 2px line, last point in the accent with a surface ring. */
export function Sparkline({
  points,
  width = 120,
  height = 32,
  className = "",
}: {
  points: number[];
  width?: number;
  height?: number;
  className?: string;
}) {
  const pts = points.slice(-12);
  if (pts.length < 2) return <svg width={width} height={height} className={className} aria-hidden="true" />;
  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const pad = 4;
  const x = (i: number) => pad + (i / (pts.length - 1)) * (width - 2 * pad);
  const y = (v: number) => (max === min ? height / 2 : pad + (1 - (v - min) / (max - min)) * (height - 2 * pad));
  const d = pts.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const last = pts.length - 1;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} className={className} aria-hidden="true">
      <path
        d={d}
        fill="none"
        stroke="var(--color-ink-3)"
        strokeWidth="2"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      <circle
        cx={x(last)}
        cy={y(pts[last] ?? 0)}
        r="4"
        fill="var(--color-accent)"
        stroke="var(--color-surface-1)"
        strokeWidth="2"
      />
    </svg>
  );
}

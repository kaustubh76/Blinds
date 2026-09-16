/** Loading placeholder that keeps the layout: same size as the thing it stands in for. */
export function Skeleton({ className = "h-4 w-24" }: { className?: string }) {
  return <div className={`animate-pulse rounded-[var(--radius-sm)] bg-surface-2 ${className}`} aria-hidden="true" />;
}

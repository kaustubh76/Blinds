import type { ReactNode } from "react";

/** A surface with a hairline. No shadows: depth comes from the surface steps, not from blur. */
export function Card({
  title,
  eyebrow,
  right,
  footer,
  tone = "default",
  className = "",
  children,
}: {
  title?: ReactNode;
  eyebrow?: ReactNode;
  right?: ReactNode;
  footer?: ReactNode;
  tone?: "default" | "accent";
  className?: string;
  children: ReactNode;
}) {
  const border = tone === "accent" ? "border-accent/40" : "border-line";
  return (
    <section className={`flex flex-col rounded-[var(--radius-lg)] border ${border} bg-surface-1 ${className}`}>
      {(title || eyebrow || right) && (
        <header className="flex items-start justify-between gap-4 px-5 pt-4 pb-3">
          <div className="min-w-0">
            {eyebrow && <div className="mono text-[11px] uppercase tracking-[0.14em] text-ink-3">{eyebrow}</div>}
            {title && <h2 className="mt-0.5 text-[15px] font-medium text-ink-1">{title}</h2>}
          </div>
          {right && <div className="shrink-0">{right}</div>}
        </header>
      )}
      <div className="px-5 pb-5">{children}</div>
      {footer && <footer className="border-t border-line px-5 py-3 text-xs text-ink-3">{footer}</footer>}
    </section>
  );
}

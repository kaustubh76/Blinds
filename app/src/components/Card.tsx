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
  tone?: "default" | "accent" | "brand" | "flat";
  className?: string;
  children: ReactNode;
}) {
  const look =
    tone === "accent"
      ? "border-accent/40 bg-surface-1"
      : tone === "brand"
        ? "border-accent/20 bg-surface-1 brand-wash"
        : tone === "flat"
          ? "border-transparent bg-surface-2"
          : "border-line bg-surface-1";
  return (
    <section className={`flex flex-col rounded-[var(--radius-lg)] border ${look} ${className}`}>
      {/* The right slot wraps under the title when a phone has no room beside it, never squeezes it. */}
      {(title || eyebrow || right) && (
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-5 pt-4 pb-3">
          <div className="min-w-0 flex-1 basis-48">
            {eyebrow && <div className="t-eyebrow">{eyebrow}</div>}
            {title && <h2 className="mt-0.5 text-base font-semibold text-ink-1">{title}</h2>}
          </div>
          {right && <div className="max-w-full shrink-0">{right}</div>}
        </header>
      )}
      <div className="px-5 pb-5">{children}</div>
      {footer && <footer className="border-t border-line px-5 py-3 text-xs text-ink-3">{footer}</footer>}
    </section>
  );
}

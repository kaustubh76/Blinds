/** Small presentational primitives. No business logic lives here. */
import type { ReactNode } from "react";

export function Panel({ title, children, right }: { title?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-panel p-4">
      {(title || right) && (
        <header className="mb-3 flex items-center justify-between">
          {title && <h2 className="text-sm font-semibold uppercase tracking-wide text-mute">{title}</h2>}
          {right}
        </header>
      )}
      {children}
    </section>
  );
}

export function Stat({ label, value, hint }: { label: string; value: ReactNode; hint?: ReactNode }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-mute">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-mute">{hint}</div>}
    </div>
  );
}

export function Badge({
  tone = "mute",
  children,
}: {
  tone?: "mute" | "good" | "warn" | "bad" | "accent";
  children: ReactNode;
}) {
  const color = {
    mute: "border-line text-mute",
    good: "border-good/40 text-good",
    warn: "border-warn/40 text-warn",
    bad: "border-bad/40 text-bad",
    accent: "border-accent/40 text-accent",
  }[tone];
  return <span className={`rounded border px-2 py-0.5 text-xs ${color}`}>{children}</span>;
}

export function Button({
  children,
  onClick,
  disabled,
  tone = "accent",
  type = "button",
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: "accent" | "mute";
  type?: "button" | "submit";
}) {
  const cls =
    tone === "accent"
      ? "bg-accent text-ink hover:bg-accent/90 disabled:bg-line disabled:text-mute"
      : "border border-line text-fg hover:bg-line disabled:text-mute";
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded px-3 py-1.5 text-sm font-medium ${cls}`}
    >
      {children}
    </button>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="block text-sm">
      <span className="mb-1 block text-xs uppercase tracking-wide text-mute">{label}</span>
      {children}
    </div>
  );
}

export const inputCls =
  "w-full rounded border border-line bg-ink px-2 py-1.5 text-sm text-fg focus:border-accent focus:outline-none";

export function Mono({ children }: { children: ReactNode }) {
  return <span className="font-mono text-xs">{children}</span>;
}

export function Note({ children, tone = "mute" }: { children: ReactNode; tone?: "mute" | "warn" | "bad" | "good" }) {
  const c = { mute: "text-mute", warn: "text-warn", bad: "text-bad", good: "text-good" }[tone];
  return <p className={`text-xs ${c}`}>{children}</p>;
}

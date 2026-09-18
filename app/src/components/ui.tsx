/** Small presentational primitives. No business logic lives here. */
import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";

export type Tone = "mute" | "good" | "warn" | "bad" | "accent" | "lend" | "borrow";

const TONE_CLASS: Record<Tone, string> = {
  mute: "border-line text-ink-2",
  good: "border-status-good/40 text-status-good",
  warn: "border-status-warning/40 text-status-warning",
  bad: "border-status-critical/40 text-status-critical",
  accent: "border-accent/40 text-accent",
  lend: "border-lend/40 text-lend",
  borrow: "border-borrow/40 text-borrow",
};

/** A chip. Status tones always travel with a glyph so colour never carries meaning alone. */
export function Badge({ tone = "mute", icon, children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-[var(--radius-sm)] border px-1.5 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]}`}
    >
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  loading,
  variant = "primary",
  size = "md",
  type = "button",
  icon,
  className = "",
  title,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  loading?: boolean;
  variant?: "primary" | "ghost" | "danger" | "hero" | "soft";
  size?: "sm" | "md" | "lg";
  type?: "button" | "submit";
  icon?: IconName;
  className?: string;
  title?: string;
}) {
  const base =
    "inline-flex items-center gap-1.5 rounded-[var(--radius-md)] font-medium transition-colors disabled:cursor-not-allowed";
  const sizing =
    size === "sm" ? "px-2.5 py-1 text-xs" : size === "lg" ? "px-5 py-3 text-base rounded-full" : "px-3.5 py-2 text-sm";
  const look = {
    primary: "bg-accent text-accent-ink hover:bg-accent/90 disabled:bg-surface-2 disabled:text-ink-3",
    hero: "brand-gradient text-white shadow-[0_8px_30px_-10px_var(--color-accent)] hover:brightness-105 disabled:opacity-60",
    soft: "bg-accent-soft text-accent hover:bg-accent/15 disabled:text-ink-3",
    ghost: "border border-line bg-surface-1 text-ink-1 hover:bg-surface-2 disabled:text-ink-3",
    danger: "border border-status-critical/50 text-status-critical hover:bg-status-critical/10 disabled:text-ink-3",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || loading}
      className={`${base} ${sizing} ${look} ${className}`}
      title={title}
    >
      {loading ? (
        <Icon name="refresh" size={14} className="animate-spin" />
      ) : icon ? (
        <Icon name={icon} size={14} />
      ) : null}
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="block text-sm">
      <span className="mono mb-1 block text-[11px] uppercase tracking-[0.14em] text-ink-3">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-ink-3">{hint}</span>}
    </div>
  );
}

export const inputCls =
  "w-full rounded-[var(--radius-md)] border border-line bg-surface-0 px-3 py-2 text-sm text-ink-1 placeholder:text-ink-3 focus:border-accent focus:outline-none";

export function Note({ children, tone = "mute" }: { children: ReactNode; tone?: "mute" | "warn" | "bad" | "good" }) {
  const c = {
    mute: "text-ink-3",
    warn: "text-status-warning",
    bad: "text-status-critical",
    good: "text-status-good",
  }[tone];
  return <p className={`text-xs leading-relaxed ${c}`}>{children}</p>;
}

/** Address / signature link to the cluster explorer. */
export function ExplorerLink({
  address,
  cluster,
  kind = "address",
  children,
}: {
  address: string;
  cluster: string;
  kind?: "address" | "tx";
  children?: ReactNode;
}) {
  const href = `https://explorer.solana.com/${kind}/${address}?cluster=${cluster}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mono inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink-1"
    >
      {children ?? `${address.slice(0, 4)}…${address.slice(-4)}`}
      <Icon name="external" size={11} className="text-ink-3" />
    </a>
  );
}

/** A rounded chip for a state or a source. */
export function Pill({ tone = "mute", icon, children }: { tone?: Tone; icon?: IconName; children: ReactNode }) {
  const c: Record<Tone, string> = {
    mute: "bg-surface-2 text-ink-2",
    good: "bg-status-good/12 text-status-good",
    warn: "bg-status-warning/12 text-status-warning",
    bad: "bg-status-critical/12 text-status-critical",
    accent: "bg-accent-soft text-accent",
    lend: "bg-lend/12 text-lend",
    borrow: "bg-borrow/12 text-borrow",
  };
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${c[tone]}`}>
      {icon && <Icon name={icon} size={12} />}
      {children}
    </span>
  );
}

/** A page section with an eyebrow, a heading and an optional lead. */
export function Section({
  eyebrow,
  title,
  lead,
  right,
  children,
  className = "",
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  lead?: ReactNode;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`grid gap-5 ${className}`}>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-[64ch]">
          {eyebrow && <div className="t-eyebrow">{eyebrow}</div>}
          <h2 className="t-h2 mt-1 text-ink-1">{title}</h2>
          {lead && <p className="mt-2 text-sm leading-relaxed text-ink-2">{lead}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/** A soft callout: an icon, a title, a sentence. */
export function Callout({
  icon = "spark",
  tone = "accent",
  title,
  children,
}: {
  icon?: IconName;
  tone?: "accent" | "warn" | "mute";
  title: ReactNode;
  children: ReactNode;
}) {
  const c = {
    accent: "border-accent/25 bg-accent-soft/60 text-ink-1",
    warn: "border-status-warning/30 bg-status-warning/8 text-ink-1",
    mute: "border-line bg-surface-2 text-ink-1",
  }[tone];
  return (
    <div className={`flex gap-3 rounded-[var(--radius-lg)] border p-4 ${c}`}>
      <span className={`mt-0.5 ${tone === "warn" ? "text-status-warning" : "text-accent"}`}>
        <Icon name={icon} size={18} />
      </span>
      <div className="min-w-0 text-sm">
        <div className="font-medium">{title}</div>
        <div className="mt-0.5 leading-relaxed text-ink-2">{children}</div>
      </div>
    </div>
  );
}

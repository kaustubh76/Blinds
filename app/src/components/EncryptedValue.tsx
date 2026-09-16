/**
 * The one component through which ciphertexts reach the screen.
 *
 * Sealed: the first bytes in mono, a lock, and a faint pattern derived from the bytes themselves —
 * the same ciphertext always looks the same and two different ones visibly differ, so a reader can
 * *see* that the 74 accumulators are 74 distinct sealed values without ever seeing a number.
 * Opened: only when the owner's browser has decrypted it with the wallet-derived key and hands the
 * result in as `plaintext`; it is then labelled as decrypted in this tab. Nothing here ever turns
 * bytes into a number by itself.
 */
import { hex } from "../lib/format";
import { Icon } from "./Icon";

/** Two hues from the leading bytes: a stable, low-contrast fingerprint of the ciphertext. */
export function sealPattern(bytes: ArrayLike<number>): string {
  const b = (i: number) => bytes[i] ?? 0;
  const h1 = ((b(0) << 8) | b(1)) % 360;
  const h2 = ((b(2) << 8) | b(3)) % 360;
  const a = (b(4) % 40) + 20; // 20–60°: the pattern's slant
  return `repeating-linear-gradient(${a}deg, hsl(${h1} 30% 22% / 0.55) 0 3px, hsl(${h2} 30% 14% / 0.55) 3px 6px)`;
}

export function EncryptedValue({
  bytes,
  plaintext,
  label,
  size = "md",
  className = "",
}: {
  bytes: ArrayLike<number>;
  /** Owner-side decryption; only ever computed in this browser. */
  plaintext?: string | null | undefined;
  label?: string | undefined;
  size?: "sm" | "md" | undefined;
  className?: string | undefined;
}) {
  const opened = plaintext != null;
  const chars = size === "sm" ? 6 : 8;
  const pad = size === "sm" ? "px-1.5 py-0.5" : "px-2 py-1";
  const text = size === "sm" ? "text-[11px]" : "text-xs";
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} data-sealed={!opened}>
      {label && <span className={`${text} text-ink-3`}>{label}</span>}
      <span
        className={`mono inline-flex items-center gap-1 rounded-[var(--radius-sm)] border ${pad} ${text} ${
          opened ? "border-accent/40 bg-surface-2 text-ink-1 animate-reveal" : "border-line text-ink-2"
        }`}
        style={opened ? undefined : { backgroundImage: sealPattern(bytes) }}
        title={opened ? "decrypted in this tab with your wallet-derived key" : `ciphertext ${hex(bytes)}`}
      >
        <Icon
          name={opened ? "unlock" : "lock"}
          size={size === "sm" ? 10 : 12}
          className={opened ? "text-accent" : "text-ink-3"}
        />
        {opened ? plaintext : `${hex(bytes, chars)}`}
      </span>
      {opened && <span className="text-[10px] uppercase tracking-[0.12em] text-ink-3">decrypted in this tab</span>}
    </span>
  );
}

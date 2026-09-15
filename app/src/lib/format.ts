/** Display helpers. Units follow spec §7.3 / amendment A3: µUSDC, milli-shares, cents, bps ticks. */
import { formatRate as sdkFormatRate, tickToBps } from "@thewindow/solana-sdk";

export const formatRate = (tick: number): string => sdkFormatRate(tick);
export const formatBps = (tick: number): string => `${tickToBps(tick)} bps`;

export function formatUsdc(micro: bigint, fractionDigits = 0): string {
  const whole = micro / 1_000_000n;
  const frac = micro % 1_000_000n;
  const s = whole.toLocaleString("en-US");
  if (fractionDigits === 0) return `${s} USDC`;
  return `${s}.${frac.toString().padStart(6, "0").slice(0, fractionDigits)} USDC`;
}

export function formatShares(milli: bigint, decimals = 3): string {
  const base = 10n ** BigInt(decimals);
  const whole = milli / base;
  const frac = (milli % base).toString().padStart(decimals, "0");
  return `${whole.toLocaleString("en-US")}.${frac}`;
}

export function formatPrice(price: bigint, expo: number): string {
  const p = Number(price) * 10 ** expo;
  return p.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export const shortAddr = (a: string, n = 4): string => (a.length > 2 * n + 1 ? `${a.slice(0, n)}…${a.slice(-n)}` : a);

export const hex = (b: ArrayLike<number>, n?: number): string => {
  const s = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return n === undefined ? s : `${s.slice(0, n)}…`;
};

/** Seconds until `target` slot at ~400 ms/slot (localnet & devnet alike). */
export function slotsToSeconds(slots: number): number {
  return Math.max(0, Math.round(slots * 0.4));
}

export function formatCountdown(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}m ${s.toString().padStart(2, "0")}s` : `${s}s`;
}

/** Parse a decimal string into base units with `decimals` fractional digits. */
export function parseUnits(input: string, decimals: number): bigint | null {
  const m = /^\s*(\d+)(?:\.(\d*))?\s*$/.exec(input);
  if (!m) return null;
  const whole = m[1] ?? "0";
  const frac = (m[2] ?? "").slice(0, decimals).padEnd(decimals, "0");
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac || "0");
}

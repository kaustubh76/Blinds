/**
 * Play before you connect: pick a collateral, type a USDC amount, see what the desk would ask you
 * to pledge at the live mark and haircut, and what of it stays private. Pure arithmetic from the
 * SDK's solvency helpers — the same numbers the lock proof will carry.
 */
import type { credit as creditNs } from "@thewindow/solana-sdk";
import {
  collateralPledge,
  collateralRequired,
  multiplierScaled,
  priceCents,
  solvencyScalars,
} from "@thewindow/solana-sdk";
import { useState } from "react";
import { Icon } from "../../components/Icon";
import { Button, Pill } from "../../components/ui";
import type { ListingView } from "../../lib/chain";
import { formatPrice, formatRate, formatShares } from "../../lib/format";
import { sourceLabel } from "../../lib/listings";

type PriceCache = creditNs.PriceCache;

export interface Quote {
  /** Milli-shares the program requires (`c·k_c ≥ ℓ·k_l`). */
  required: bigint;
  /** The desk's pledge policy (160 % of the requirement). */
  pledge: bigint;
  /** USD value of the pledge at the mark. */
  pledgeUsd: number;
  kC: bigint;
  kL: bigint;
}

/** What a loan of `usdc` needs on `listing` at `price`; null when a value is out of range. */
export function quoteCollateral(usdc: number, listing: ListingView, price: PriceCache, multiplier = 1): Quote | null {
  if (!(usdc > 0) || !Number.isFinite(usdc)) return null;
  try {
    const pc = priceCents(price.price, price.expo);
    const ms = multiplierScaled(multiplier);
    const s = solvencyScalars(pc, ms, listing.haircutBps);
    const micro = BigInt(Math.round(usdc * 1_000_000));
    const required = collateralRequired(micro, s);
    const pledge = collateralPledge(micro, s);
    const usd = Number(price.price) * 10 ** price.expo;
    return { required, pledge, pledgeUsd: (Number(pledge) / 1_000) * usd * multiplier, kC: s.kC, kL: s.kL };
  } catch {
    return null;
  }
}

export function BorrowCalculator({
  listings,
  prices,
  lastRateTick,
  onStart,
}: {
  listings: ListingView[];
  prices: Array<PriceCache | null> | undefined;
  lastRateTick: number | null;
  onStart: (key: string, usdc: number) => void;
}) {
  const [key, setKey] = useState(listings[0]?.key ?? "");
  const [amount, setAmount] = useState("1000");
  const i = Math.max(
    0,
    listings.findIndex((l) => l.key === key),
  );
  const listing = listings[i];
  const price = prices?.[i] ?? null;
  const usdc = Number(amount.replace(/[^0-9.]/g, ""));
  const q = listing && price ? quoteCollateral(usdc, listing, price) : null;
  const shares = q ? formatShares(q.pledge, listing?.decimals ?? 3) : "—";
  return (
    <div className="grid gap-5 rounded-[var(--radius-xl)] border border-line bg-surface-1 p-5 sm:p-6 lg:grid-cols-[1fr_1.1fr]">
      <div className="grid gap-4">
        <div>
          <div className="t-eyebrow">borrow</div>
          <div className="mt-1 flex items-baseline gap-2">
            <span className="text-2xl font-semibold text-ink-1">$</span>
            <input
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              aria-label="USDC to borrow"
              className="num w-full bg-transparent text-4xl font-semibold tracking-tight text-ink-1 outline-none placeholder:text-ink-3"
              placeholder="1000"
            />
            <span className="text-sm text-ink-3">USDC</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {[250, 1_000, 5_000, 25_000].map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => setAmount(String(v))}
                className="rounded-full border border-line px-2.5 py-0.5 text-xs text-ink-2 hover:border-line-strong hover:text-ink-1"
              >
                ${v.toLocaleString("en-US")}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="t-eyebrow">against</div>
          <div className="mt-2 grid gap-1.5">
            {listings.map((l, j) => {
              const on = l.key === (listing?.key ?? "");
              const p = prices?.[j] ?? null;
              return (
                <button
                  key={l.key}
                  type="button"
                  onClick={() => setKey(l.key)}
                  aria-pressed={on}
                  className={`flex items-center justify-between gap-3 rounded-[var(--radius-md)] border px-3 py-2 text-left text-sm transition-colors ${
                    on ? "border-accent bg-accent-soft/50" : "border-line hover:border-line-strong"
                  }`}
                >
                  <span className="font-medium text-ink-1">{l.symbol.replace(/-mock$/, "")}</span>
                  <span className="flex items-center gap-2 text-xs text-ink-3">
                    {p ? formatPrice(p.price, p.expo) : "—"}
                    <Pill tone="mute">{Number(l.haircutBps) / 100}%</Pill>
                    <span className="hidden sm:inline">{sourceLabel(l.source)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
      <div className="grid content-between gap-4 rounded-[var(--radius-lg)] bg-surface-2 p-5">
        <div className="grid gap-4">
          <div>
            <div className="t-eyebrow">you would pledge</div>
            <div className="num mt-1 text-3xl font-semibold tracking-tight text-ink-1">
              {shares} <span className="text-base font-medium text-ink-2">{listing?.symbol.replace(/-mock$/, "")}</span>
            </div>
            <div className="mt-1 text-sm text-ink-2">
              {q
                ? `≈ ${q.pledgeUsd.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} at the live mark — ${Number(listing?.haircutBps ?? 0n) / 100}% coverage plus the desk's 60% cushion`
                : price
                  ? "enter an amount"
                  : "no quote for this listing yet"}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div className="rounded-[var(--radius-md)] bg-surface-1 p-3">
              <div className="t-eyebrow">estimated rate</div>
              <div className="num mt-1 text-lg font-semibold text-ink-1">
                {lastRateTick !== null ? formatRate(lastRateTick) : "—"}
              </div>
              <div className="text-xs text-ink-3">last window's print; yours clears in the next</div>
            </div>
            <div className="rounded-[var(--radius-md)] bg-surface-1 p-3">
              <div className="t-eyebrow">minimum</div>
              <div className="num mt-1 text-lg font-semibold text-ink-1">
                {q ? formatShares(q.required, listing?.decimals ?? 3) : "—"}
              </div>
              <div className="text-xs text-ink-3">what the proof must cover</div>
            </div>
          </div>
          <ul className="grid gap-1.5 text-sm">
            <li className="flex items-center gap-2 text-ink-2">
              <Icon name="eyeOff" size={14} className="text-accent" /> loan size and collateral: encrypted on chain
            </li>
            <li className="flex items-center gap-2 text-ink-2">
              <Icon name="eye" size={14} className="text-ink-3" /> rate, listing and timing: public
            </li>
          </ul>
        </div>
        <Button
          variant="hero"
          size="lg"
          icon="arrowRight"
          onClick={() => listing && onStart(listing.key, usdc)}
          disabled={!listing || !(usdc > 0)}
        >
          Start with this on the desk
        </Button>
      </div>
    </div>
  );
}

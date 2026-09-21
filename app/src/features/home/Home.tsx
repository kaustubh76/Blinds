/** Home: the hook. What this is, the live window, the collateral you can bring, a calculator to play with, how it works. */
import { PrintStatus } from "@thewindow/solana-sdk";
import { useState } from "react";
import { Countdown } from "../../components/Countdown";
import { Icon, type IconName } from "../../components/Icon";
import { ListingCard } from "../../components/ListingCard";
import { Button, Callout, Pill, Section } from "../../components/ui";
import { WindowClock } from "../../components/WindowClock";
import { BURNER_WALLET_NAME, createBurner, hasBurner } from "../../lib/burner";
import { formatRate, formatUsdc } from "../../lib/format";
import { LAUNCH } from "../../lib/launch";
import { useSelectedListing } from "../../lib/listings";
import { useDeployment, useOracle, usePrices, useSeries, useSlot } from "../../lib/queries";
import { useHashRoute } from "../../lib/useHashRoute";
import { useWindowClock } from "../../lib/useWindowClock";
import { useSession } from "../../lib/wallet";
import { BorrowCalculator } from "./BorrowCalculator";

export const DESK_PREFILL_KEY = "thewindow:desk:prefill";

export function Home() {
  const dep = useDeployment();
  const oracle = useOracle();
  const slot = useSlot();
  const clock = useWindowClock();
  const session = useSession();
  const { go } = useHashRoute();
  const { listings, selected, select } = useSelectedListing();
  const prices = usePrices(dep.data?.listings);
  const lastPrinted = oracle.data?.hasPrinted ? oracle.data.lastPrintEpoch : null;
  const series = useSeries(clock.epoch ?? lastPrinted, 12);
  const xonia = oracle.data?.hasPrinted && oracle.data.lastRStarTick !== 255 ? oracle.data.lastRStarTick : null;
  const prints = (series.data ?? [])
    .filter((s) => s.print.status === PrintStatus.Printed)
    .slice(-3)
    .reverse();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const burner = session.wallets.find((w) => w.name === BURNER_WALLET_NAME);
  const tryIt = () => {
    setError(null);
    setBusy(true);
    (async () => {
      if (!session.address) {
        if (!burner) throw new Error("the devnet burner wallet is not available in this browser");
        if (!hasBurner()) await createBurner();
        await session.connect(burner);
      }
      go("desk");
    })()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setBusy(false));
  };
  const start = (key: string, usdc: number) => {
    select(key);
    try {
      sessionStorage.setItem(DESK_PREFILL_KEY, JSON.stringify({ key, usdc }));
    } catch {
      // convenience only
    }
    go("desk");
  };

  return (
    <div className="grid gap-12">
      {/* Hero */}
      <section className="brand-wash grid gap-8 rounded-[var(--radius-xl)] border border-line bg-surface-1 px-6 py-8 sm:px-10 sm:py-12 lg:grid-cols-[1.15fr_1fr] lg:items-center">
        <div className="animate-rise">
          <Pill tone="accent" icon="sparkles">
            live on Solana devnet · one rate, two collaterals
          </Pill>
          <h1 className="t-display mt-4 text-ink-1">
            Borrow against tokenized stock.
            <br />
            <span className="brand-text">Privately.</span>
          </h1>
          <p className="t-lead mt-5 max-w-[52ch]">
            Pledge xStocks or pre-IPO tokens, borrow USDC overnight at a rate the whole market clears — while your loan
            size and your collateral stay encrypted on chain. The rate is public. The price is public. The position
            never was.
          </p>
          <div className="mt-7 flex flex-wrap items-center gap-3">
            <Button variant="hero" size="lg" icon="zap" onClick={tryIt} loading={busy}>
              {session.address ? "Open the desk" : "Try it with a devnet burner"}
            </Button>
            {!session.address && (
              <Button variant="ghost" size="lg" icon="wallet" onClick={() => go("desk")}>
                Connect a wallet
              </Button>
            )}
            <span className="text-xs text-ink-3">no funds needed — the desk mints devnet twins for you</span>
          </div>
          {error && <p className="mt-3 text-sm text-status-critical">{error}</p>}
        </div>
        <div className="animate-rise flex flex-col items-center gap-4 [animation-delay:120ms]">
          <div className="animate-float">
            <WindowClock clock={clock} size={220} />
          </div>
          <div className="text-center">
            <div className="t-eyebrow">xONIA · the overnight rate</div>
            <div className="num mt-1 text-4xl font-semibold tracking-tight text-ink-1">
              {xonia !== null ? formatRate(xonia) : "—"}
            </div>
            <div className="mt-1 text-sm text-ink-3">
              {clock.phase === "open" && clock.secondsLeft !== null ? (
                <>
                  this window closes in <Countdown slots={clock.secondsLeft / 0.45} />
                </>
              ) : clock.phase === "printing" ? (
                "proving the print, tick by tick"
              ) : lastPrinted !== null ? (
                `last printed at epoch ${lastPrinted}`
              ) : (
                "waiting for the first window"
              )}
            </div>
          </div>
        </div>
      </section>

      {/* Collateral */}
      <Section
        eyebrow="what you can bring"
        title={`${["No", "One", "Two", "Three", "Four"][listings.length] ?? listings.length} collateral${listings.length === 1 ? "" : "s"}, one rate`}
        lead="Each listing is marked by its own source and carries its own haircut; the chain refuses a lock or a seizure when the quote is not fresh."
        right={
          <a href="#/market" className="text-sm text-accent hover:underline">
            the full schedule →
          </a>
        }
      >
        <div className={`grid gap-4 ${listings.length >= 3 ? "md:grid-cols-3" : "md:grid-cols-2"}`}>
          {listings.map((l, i) => (
            <ListingCard
              key={l.key}
              listing={l}
              price={prices.data?.[i]}
              slot={slot.data}
              selected={selected?.key === l.key}
              onSelect={(k) => {
                select(k);
                go("desk");
              }}
            />
          ))}
        </div>
        <p className="mt-4 text-sm text-ink-3">
          The lender on the other side of every window is an autonomous agent; its token,{" "}
          <span className="mono">{LAUNCH.token.symbol}</span>, is on a stock-quoted Meteora bonding curve —{" "}
          <a href="#/market" className="text-accent hover:underline">
            the curve →
          </a>
        </p>
      </Section>

      {/* Calculator */}
      <Section
        eyebrow="try the numbers"
        title="What would a loan cost you?"
        lead="Live marks, the listing's haircut, the desk's cushion — the same arithmetic your solvency proof will carry."
      >
        <BorrowCalculator listings={listings} prices={prices.data} lastRateTick={xonia} onStart={start} />
      </Section>

      {/* How it works */}
      <Section eyebrow="how it works" title="A window, a print, a proof">
        <div className="grid gap-4 md:grid-cols-3">
          <Step
            icon="lock"
            n="1"
            title="Seal a bid"
            text="Choose a side, a rate and a size. The size is encrypted to your key and the desk's auditor key before it leaves your browser."
          />
          <Step
            icon="clock"
            n="2"
            title="The window clears"
            text="Every few minutes the sealed bids are summed on chain — as ciphertexts. The administrator proves each per-rate sum and one uniform rate prints: xONIA."
          />
          <Step
            icon="shield"
            n="3"
            title="Prove, lock, borrow"
            text="Matched? Prove your collateral covers the loan at the live mark without revealing either number, lock it in escrow, and the loan is funded."
          />
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <Callout icon="eyeOff" title="What stays private">
            Your bid size, your loan size, your collateral. They live on chain only as ElGamal ciphertexts; the
            administrator can read them to run the market and proves every aggregate it publishes.
          </Callout>
          <Callout icon="eye" tone="mute" title="What is public by design">
            That you are a member, which side you took, the rate ticks, the timing, the clearing rate and the matched
            volume — and every proof, which this site re-verifies in your browser.
          </Callout>
        </div>
      </Section>

      {/* Live strip */}
      <Section eyebrow="right now" title="Recent windows">
        <div className="grid gap-3 sm:grid-cols-3">
          {prints.length === 0 && (
            <div className="rounded-[var(--radius-lg)] border border-dashed border-line p-5 text-sm text-ink-3">
              The first print of this session is on its way.
            </div>
          )}
          {prints.map((s) => (
            <a
              key={s.epoch.toString()}
              href={`#/explorer/${s.epoch.toString()}`}
              className="rounded-[var(--radius-lg)] border border-line bg-surface-1 p-4 transition-colors hover:border-line-strong"
            >
              <div className="t-eyebrow">epoch {s.epoch.toString()}</div>
              <div className="num mt-1 text-2xl font-semibold text-ink-1">{formatRate(s.print.rStarTick)}</div>
              <div className="mt-1 text-xs text-ink-3">
                {formatUsdc(s.print.matchedVolume)} matched · {s.print.matchesPosted} loans, sizes never public
              </div>
            </a>
          ))}
        </div>
      </Section>
    </div>
  );
}

function Step({ icon, n, title, text }: { icon: IconName; n: string; title: string; text: string }) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-surface-1 p-5">
      <div className="flex items-center gap-3">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-accent-soft text-accent">
          <Icon name={icon} size={18} />
        </span>
        <span className="t-eyebrow">step {n}</span>
      </div>
      <div className="mt-3 text-base font-semibold text-ink-1">{title}</div>
      <p className="mt-1.5 text-sm leading-relaxed text-ink-2">{text}</p>
    </div>
  );
}

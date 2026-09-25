/**
 * "Built with": the four integrations as a first-time visitor should meet them — what each one does
 * in this product, one live number read the same way the rest of the dashboard reads it, and where
 * to look next. No integration is a logo here; each is a job.
 */
import { Icon, type IconName } from "../../components/Icon";
import { Pill, Section, type Tone } from "../../components/ui";
import { formatAge, formatPrice } from "../../lib/format";
import { LAUNCH, useLaunch } from "../../lib/launch";
import { FEEDS, useUnderlying } from "../../lib/pyth";
import { useDeployment, useQuote } from "../../lib/queries";

interface Tile {
  name: string;
  tone: Tone;
  icon: IconName;
  role: string;
  live: string | null;
  liveHint: string;
  href: string;
  cta: string;
}

function TileView({ t }: { t: Tile }) {
  return (
    <a
      href={t.href}
      className="group grid content-start gap-2 rounded-[var(--radius-lg)] border border-line bg-surface-1 p-5 transition-colors hover:border-accent/40"
      data-integration={t.name}
    >
      <div className="flex items-center justify-between gap-2">
        <Pill tone={t.tone} icon={t.icon}>
          {t.name}
        </Pill>
        <Icon name="arrowRight" size={14} className="text-ink-3 transition-transform group-hover:translate-x-0.5" />
      </div>
      <p className="text-sm leading-relaxed text-ink-2">{t.role}</p>
      <div className="mt-1">
        <div className="num text-lg font-semibold text-ink-1">{t.live ?? "—"}</div>
        <div className="text-xs text-ink-3">{t.liveHint}</div>
      </div>
      <span className="text-xs text-accent">{t.cta}</span>
    </a>
  );
}

export function Integrations() {
  const dep = useDeployment();
  const pyth = useQuote(dep.data?.listings.find((l) => l.source === "pyth"));
  const equity = useUnderlying(FEEDS["Equity.US.TSLA/USD"]);
  const prestocksListing = dep.data?.listings.find((l) => l.source === "prestocks");
  const prestocks = useQuote(prestocksListing);
  // The haircut is the descriptor's, never a sentence: an `update_listing` must not make this page lie.
  const haircutPct = Number(prestocksListing?.haircutBps ?? Number.NaN) / 100;
  const prestocksHaircut = Number.isFinite(haircutPct) ? `${haircutPct} %` : "its own";
  const launch = useLaunch();
  const pool = launch.data?.kind === "ok" ? launch.data.state : null;

  const tiles: Tile[] = [
    {
      name: "Pyth",
      tone: "accent",
      icon: "chart",
      role: "The mark inside every solvency proof, and the gate on every seizure.",
      live: pyth.data
        ? formatPrice(pyth.data.price, pyth.data.expo)
        : equity.data
          ? formatPrice(equity.data.price, equity.data.expo)
          : null,
      liveHint: pyth.data
        ? `TSLAx mark · quote published ${formatAge(pyth.data.publishTime)}`
        : equity.data
          ? `TSLA equity from Pyth's mainnet account · ${formatAge(equity.data.publishTime)}`
          : "reading Pyth…",
      href: "#/market",
      cta: "the mark, both feeds, the freshness rules →",
    },
    {
      name: "PreStocks",
      tone: "borrow",
      icon: "layers",
      role: `A pre-IPO token as collateral, at a ${prestocksHaircut} haircut.`,
      live: prestocks.data ? formatPrice(prestocks.data.price, prestocks.data.expo) : null,
      liveHint: prestocks.data
        ? `ANTHROPIC mark · fetched ${formatAge(prestocks.data.publishTime)}`
        : dep.data && !prestocksListing
          ? "no PreStocks listing in this deployment"
          : "reading the on-chain mark…",
      href: "#/market/prestocks",
      cta: "the mark, the implied price, the basis →",
    },
    {
      name: "Meteora DBC",
      tone: "lend",
      icon: "sparkles",
      role: `${LAUNCH.token.symbol} on a bonding curve quoted in a tokenized stock.`,
      live: pool ? `${(pool.progress * 100).toFixed(1)} %` : null,
      liveHint: pool
        ? `of the way to graduation · ${LAUNCH.cluster === "mainnet" ? "mainnet, quoted in TSLAx" : "devnet rehearsal"}`
        : launch.data?.kind === "missing"
          ? "pool not on chain yet"
          : "reading the pool…",
      href: "#/agent",
      cta: "the curve, the fee now, the raise →",
    },
    {
      name: "Clawpump",
      tone: "good",
      icon: "users",
      role: "The agent's identity and wallet — the pool's fee claimer, earning every fee.",
      live: LAUNCH.agent ? LAUNCH.agent.name : null,
      liveHint: LAUNCH.clawpump
        ? `${LAUNCH.clawpump.symbol} live on pump.fun`
        : LAUNCH.agent
          ? "identity recorded · the coin waits on the agent's wallet"
          : "no identity recorded yet",
      href: "#/agent",
      cta: "the agent, its wallet, its coin →",
    },
  ];

  return (
    <Section
      eyebrow="built with"
      title="Four integrations, each doing a job"
      lead="Every number below is read from the chain, from Pyth, or from a launch record."
    >
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {tiles.map((t) => (
          <TileView key={t.name} t={t} />
        ))}
      </div>
    </Section>
  );
}

/**
 * The lender agent, as a page: what it does on the desk, where it stands on its way to a token on
 * mainnet, the Meteora curve set from the desk's numbers, its Clawpump identity, and the developer
 * surface. Every status comes from a record or the chain; every pending step names what it waits on.
 */
import { Card } from "../../components/Card";
import { Icon, type IconName } from "../../components/Icon";
import { Stat } from "../../components/Stat";
import { Badge, ExplorerLink, Pill, type Tone } from "../../components/ui";
import { formatRate } from "../../lib/format";
import { DEVNET_LAUNCH, LAUNCH, launchCluster, MAINNET_LAUNCH, useLaunch } from "../../lib/launch";
import { useDeployment, useOracle } from "../../lib/queries";
import { LenderTrack } from "../build/LenderTrack";
import { LenderAgent } from "../market/LenderAgent";
import { journey, type StepState } from "./journey";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const TONE: Record<StepState, Tone> = { done: "good", pending: "mute", blocked: "warn" };
const ICON: Record<StepState, IconName> = { done: "check", pending: "clock", blocked: "alert" };
const WORD: Record<StepState, string> = { done: "done", pending: "pending", blocked: "waits on you" };

function Journey({ live }: { live: { isMigrated: boolean; progress: number } | null }) {
  const steps = journey(DEVNET_LAUNCH, MAINNET_LAUNCH, live);
  const done = steps.filter((s) => s.state === "done").length;
  return (
    <Card
      eyebrow="the journey"
      title={`${done} of ${steps.length} steps done`}
      right={
        <Badge tone={done === steps.length ? "good" : "accent"}>
          {MAINNET_LAUNCH ? "on mainnet" : "devnet rehearsal · mainnet next"}
        </Badge>
      }
    >
      <ol className="grid gap-2 md:grid-cols-5">
        {steps.map((s, i) => (
          <li
            key={s.id}
            className="grid content-start gap-1.5 rounded-[var(--radius-md)] border border-line bg-surface-0 p-3"
            data-state={s.state}
          >
            <div className="flex items-center gap-2">
              <span className="mono text-[10px] uppercase tracking-[0.14em] text-ink-3">step {i + 1}</span>
              <Pill tone={TONE[s.state]} icon={ICON[s.state]}>
                {WORD[s.state]}
              </Pill>
            </div>
            <div className="text-sm font-semibold text-ink-1">{s.title}</div>
            <p className="text-xs leading-relaxed text-ink-2">{s.detail}</p>
            {s.href && (
              <a href={s.href} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                open →
              </a>
            )}
          </li>
        ))}
      </ol>
    </Card>
  );
}

function OnDesk() {
  const dep = useDeployment();
  const oracle = useOracle();
  const agents = dep.data?.raw.agents ?? [];
  const lenders = agents.filter((a) => a.role === "lender");
  const borrowers = agents.filter((a) => a.role === "borrower");
  const listings = dep.data?.listings ?? [];
  const lendsOn = Array.from(new Set(lenders.map((a) => listings[a.listing ?? 0]?.symbol).filter(Boolean)));
  const xonia =
    oracle.data?.hasPrinted && oracle.data.lastRStarTick !== 255 ? formatRate(oracle.data.lastRStarTick) : null;
  return (
    <Card
      eyebrow="on the desk · devnet"
      title="An autonomous lender that quotes every window"
      footer={
        <>
          The simulated members are ours and labelled as such in <span className="mono">deployments/devnet.json</span>
          {" — "}the depth they provide is not organic demand. Bids are sealed and summed on chain as ciphertexts; the
          administrator decrypts the sums, never a position, and proves each print.
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="lender agents"
          value={dep.data ? lenders.length : "—"}
          hint={lendsOn.length ? `lending on ${lendsOn.join(" and ")}` : "from the deployment descriptor"}
        />
        <Stat
          label="borrower agents"
          value={dep.data ? borrowers.length : "—"}
          hint="the other side of every window; a judge's burner joins them"
        />
        <Stat
          label="last printed xONIA"
          value={xonia ?? "—"}
          hint={
            oracle.data?.hasPrinted
              ? `epoch ${oracle.data.lastPrintEpoch} · what the agent earns overnight`
              : "no print yet"
          }
        />
      </div>
      <p className="mt-3 text-sm text-ink-2">
        Every overnight window the lender agent seals a lending bid, the desk clears one uniform rate — xONIA — and the
        agent's USDC goes to borrowers whose tokenized-stock collateral is proven solvent in zero knowledge against
        Pyth's mark or PreStocks' mark. Its yield is that rate; its capital token and its identity coin are what the
        rest of this page is about.{" "}
        <a href="#/market" className="text-accent hover:underline">
          the market →
        </a>{" "}
        ·{" "}
        <a href="#/explorer" className="text-accent hover:underline">
          the last print, re-verified →
        </a>
      </p>
    </Card>
  );
}

function CurveFromDesk({ live }: { live: ReturnType<typeof useLaunch>["data"] }) {
  const s = live?.kind === "ok" ? live.state : null;
  const n = LAUNCH.numbers;
  const q = LAUNCH.quote;
  const fmtQ = (v: number) =>
    `${v.toLocaleString("en-US", { maximumFractionDigits: 2 })} ${LAUNCH.cluster === "mainnet" ? "TSLAx" : "quote"}`;
  const rows: Array<[string, string, string]> = [
    [
      "quote token",
      "the desk's own collateral class: a tokenized stock",
      LAUNCH.cluster === "mainnet" ? "TSLAx (xStocks), Meteora-badged" : "a devnet twin of TSLAx (8 dp)",
    ],
    [
      "opening value",
      `${usd(n.initialUsd)} fully diluted ÷ the quote stock's price`,
      `${fmtQ(n.initialMarketCapQuote)} at ${usd(q.usd)} (Pyth ${q.feed ?? "Crypto.TSLAX/USD"})`,
    ],
    [
      "raise target",
      `${usd(n.migrationUsd)} fully diluted — the agent's lending capital`,
      s
        ? `${fmtQ(s.thresholdQuote)} raised before graduating (on chain)`
        : `${fmtQ(n.migrationQuoteThreshold ?? n.migrationMarketCapQuote / 4)} raised before graduating (planned)`,
    ],
    [
      "fee schedule",
      `one tenor of the desk (${n.feeBps.durationSecs / 3600} h): ${n.feeBps.open} → ${n.feeBps.rest} bp`,
      s
        ? `${s.config.baseFee.cliffBps} bp cliff · ${s.config.baseFee.numberOfPeriod} periods of ${s.config.baseFee.periodFrequency} s · −${(s.config.baseFee.reductionFactor / 100).toFixed(2)} %/period (on chain)`
        : `${n.feeBps.periods} periods (planned)`,
    ],
    [
      "who earns",
      `${n.creatorFeePct} % of trading fees and ${n.raiseToAgentPct} % of the raise → the agent's Clawpump wallet`,
      s
        ? s.feesToAgent === true
          ? "creator and fee claimer are the agent wallet (verified on chain)"
          : s.feesToAgent === false
            ? LAUNCH.cluster === "mainnet"
              ? "creator or fee claimer differs from the agent wallet"
              : "the rehearsal was launched by the payer before the identity existed; the mainnet pool's creator is the agent wallet"
            : `creator ${LAUNCH.creator.slice(0, 4)}…${LAUNCH.creator.slice(-4)} (no agent recorded)`
        : "reads from the pool",
    ],
    ["after graduation", "liquidity moves to DAMM v2", "both LP positions permanently locked"],
    ["supply", "fixed, no vesting", `${n.supply.toLocaleString("en-US")} ${LAUNCH.token.symbol}, 6 decimals`],
  ];
  return (
    <Card
      eyebrow="the curve, set from the desk's numbers"
      title="Why this pool looks the way it does"
      right={
        <ExplorerLink address={LAUNCH.config} cluster={launchCluster}>
          pool config
        </ExplorerLink>
      }
      footer={
        <>
          <span className="mono">services/launch/src/plan.ts</span> turns these desk numbers into Meteora&apos;s{" "}
          <span className="mono">buildCurveWithMarketCap</span> parameters; the on-chain column is decoded from the
          config account by <span className="mono">sdk.fetchDbc</span>. Devnet uses a twin quote mint; the mainnet pool
          is quoted in TSLAx itself.
        </>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead className="mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
            <tr>
              <th className="py-1.5 pr-3 font-normal">parameter</th>
              <th className="py-1.5 pr-3 font-normal">from the desk</th>
              <th className="py-1.5 font-normal">on the curve</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(([k, from, on]) => (
              <tr key={k} className="border-t border-line align-top">
                <td className="py-2 pr-3 font-medium text-ink-1">{k}</td>
                <td className="py-2 pr-3 text-ink-2">{from}</td>
                <td className="py-2 text-ink-2">{on}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Clawpump() {
  const a = LAUNCH.agent;
  const c = LAUNCH.clawpump;
  return (
    <Card
      eyebrow="Clawpump · identity and wallet"
      title={a ? a.name : "no Clawpump identity yet"}
      right={
        <span className="flex flex-wrap items-center gap-2">
          {a?.status === "running" ? (
            <Badge tone="good" icon="check">
              agent running
            </Badge>
          ) : a ? (
            <Badge tone="warn" icon="alert">
              agent {a.status ?? "status unknown"}
            </Badge>
          ) : null}
          {c ? (
            <Badge tone="good" icon="check">
              identity coin live
            </Badge>
          ) : (
            <Badge tone="mute">identity coin pending</Badge>
          )}
          <a
            href="https://clawpump.tech"
            target="_blank"
            rel="noreferrer"
            className="text-xs text-accent hover:underline"
          >
            clawpump.tech →
          </a>
        </span>
      }
      footer={
        <>
          Clawpump gives an agent an identity and a wallet, and launches a coin for it on pump.fun — paired here with
          TSLAx from Clawpump&apos;s own stock pairs. It does not create Meteora pools, and a Meteora DBC pool mints its
          own token; so the agent has two coins with two roles. Honest limits: the lending loop the agent earns from is
          the devnet desk, and this agent carries no persona — Clawpump&apos;s partner API takes a persona only when an
          agent is created, and this one was made in Clawpump&apos;s own console.
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="agent"
          value={a ? a.name : "—"}
          hint={
            a
              ? `Clawpump id ${a.id.slice(0, 8)}… · ${a.status === "running" ? "running — what Clawpump counts as deployed" : `status ${a.status ?? "unknown"}`}`
              : "run services/launch agent"
          }
        />
        <Stat
          label="wallet"
          value={a ? <ExplorerLink address={a.walletAddress} cluster="mainnet-beta" /> : "—"}
          hint="the Meteora pool's creator and fee claimer; pays its own pump.fun launch"
        />
        <Stat
          label="identity coin"
          value={c ? c.symbol : "LENDER"}
          hint={
            c ? (
              <span className="flex flex-wrap gap-2">
                <a href={c.pumpUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
                  pump.fun
                </a>
                <ExplorerLink address={c.mint} cluster="mainnet-beta">
                  mint
                </ExplorerLink>
                <ExplorerLink address={c.txHash} cluster="mainnet-beta" kind="tx">
                  launch tx
                </ExplorerLink>
              </span>
            ) : (
              "pump.fun, paired with TSLAx — launched by the agent's wallet once it holds ~0.02 SOL"
            )
          }
        />
      </div>
    </Card>
  );
}

export function Agent() {
  const l = useLaunch();
  const live =
    l.data?.kind === "ok" ? { isMigrated: l.data.state.pool.isMigrated, progress: l.data.state.progress } : null;
  return (
    <div className="grid gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4 pb-2">
        <div>
          <div className="t-eyebrow">the lender agent · Meteora DBC · Clawpump</div>
          <h1 className="t-h1 mt-1 text-ink-1">An agent that lends, and owns its own curve</h1>
        </div>
        <p className="max-w-[52ch] text-sm text-ink-2">
          The desk&apos;s lender is an autonomous agent. Its capital token{" "}
          <span className="mono">{LAUNCH.token.symbol}</span> runs on a Meteora bonding curve quoted in a tokenized
          stock and configured from the desk&apos;s numbers; its identity lives on Clawpump. Everything below is read
          from records and the chain.
        </p>
      </div>
      <Journey live={live} />
      <OnDesk />
      <LenderAgent />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <CurveFromDesk live={l.data} />
        <Clawpump />
      </div>
      <Card eyebrow="for developers" title="Read the pool the way the dashboard does">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
          <LenderTrack />
          <p className="text-xs text-ink-3 lg:max-w-[28ch]">
            <Icon name="code" size={11} className="mr-1 inline" />
            The Build page runs this as the <span className="mono">launch-status</span> recipe in your tab; DevTools has{" "}
            <span className="mono">thewindow.launch()</span>.{" "}
            <a href="#/build" className="text-accent hover:underline">
              Build →
            </a>
          </p>
        </div>
      </Card>
    </div>
  );
}

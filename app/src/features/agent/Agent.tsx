/**
 * The lender agent, as a page: what it does on the desk, where it stands on its way to a token on
 * mainnet, the Meteora curve set from the desk's numbers, its Clawpump identity, and the developer
 * surface. Every status comes from a record or the chain; every pending step names what it waits on.
 */
import { useState } from "react";
import { BridgeRun } from "../../components/BridgeRun";
import { Card } from "../../components/Card";
import { Icon, type IconName } from "../../components/Icon";
import { Stat } from "../../components/Stat";
import { Badge, DocLink, ExplorerLink, Note, Pill, type Tone } from "../../components/ui";
import { formatRate } from "../../lib/format";
import { DEVNET_LAUNCH, LAUNCH, launchCluster, MAINNET_LAUNCH, useLaunch } from "../../lib/launch";
import { useDeployment, useMainnetMint, useOracle } from "../../lib/queries";
import { LenderTrack } from "../build/LenderTrack";
import { LenderAgent } from "../market/LenderAgent";
import { AgentRoster } from "./AgentRoster";
import { BrowserAgent } from "./BrowserAgent";
import { journey, type StepState } from "./journey";

const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
const TONE: Record<StepState, Tone> = { done: "good", pending: "mute", blocked: "warn" };
const ICON: Record<StepState, IconName> = { done: "check", pending: "clock", blocked: "alert" };
const WORD: Record<StepState, string> = { done: "done", pending: "pending", blocked: "waits on you" };

function Journey({ live }: { live: { isMigrated: boolean; progress: number } | null }) {
  // The identity-coin step waits for the mint to answer, the same way the pool step waits for the pool.
  const coin = useMainnetMint(LAUNCH.clawpump?.mint);
  const steps = journey(DEVNET_LAUNCH, MAINNET_LAUNCH, live, coin.data ? { supply: coin.data.supply } : null);
  const done = steps.filter((s) => s.state === "done").length;
  // The step you would act on: the first that is not finished, else the last one.
  const [picked, setPicked] = useState<string | null>(null);
  const suggested = steps.find((x) => x.state !== "done")?.id ?? steps[steps.length - 1]?.id ?? null;
  const openId = picked ?? suggested;
  const open = steps.find((x) => x.id === openId) ?? null;
  return (
    <Card
      eyebrow="the journey"
      title={`${done} of ${steps.length} steps done`}
      right={
        <Badge tone={done === steps.length ? "good" : "accent"}>
          {MAINNET_LAUNCH ? "on mainnet" : "devnet rehearsal · mainnet next"}
        </Badge>
      }
      footer="Pick a step to see the command that moves it along."
    >
      <ol className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
        {steps.map((s, i) => (
          <li key={s.id} data-state={s.state}>
            <button
              type="button"
              onClick={() => setPicked(s.id)}
              aria-expanded={s.id === openId}
              className={`grid h-full w-full content-start gap-1.5 rounded-[var(--radius-md)] border p-3 text-left transition-colors ${
                s.id === openId ? "border-accent bg-surface-1" : "border-line bg-surface-0 hover:border-accent/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <span className="mono text-[10px] uppercase tracking-[0.14em] text-ink-3">step {i + 1}</span>
                <Pill tone={TONE[s.state]} icon={ICON[s.state]}>
                  {WORD[s.state]}
                </Pill>
              </div>
              <div className="text-sm font-semibold text-ink-1">{s.title}</div>
              <p className="text-xs leading-relaxed text-ink-2">{s.detail}</p>
            </button>
          </li>
        ))}
      </ol>
      {open && (
        <div className="mt-4 grid gap-2 border-t border-line pt-4">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
              step {steps.findIndex((x) => x.id === open.id) + 1}
            </span>
            <span className="text-sm font-semibold text-ink-1">{open.title}</span>
            {open.href && (
              <a href={open.href} target="_blank" rel="noreferrer" className="text-xs text-accent hover:underline">
                open →
              </a>
            )}
          </div>
          {open.commands?.length ? (
            <BridgeRun ids={open.commands} />
          ) : (
            <Note>Nothing to run here: this step is a consequence of the others, not an action.</Note>
          )}
        </div>
      )}
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
          Ours, and labelled <span className="mono">simulated</span> in the deployment file — this depth is not organic
          demand.
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
      <div className="mt-4">
        <AgentRoster
          agents={agents.map((a) => ({
            index: a.index,
            wallet: a.wallet,
            role: a.role,
            listing: a.listing,
            symbol: listings[a.listing ?? 0]?.symbol,
          }))}
        />
      </div>
      <p className="mt-3 text-sm text-ink-2">
        It seals a lending bid every window and earns whatever prints.{" "}
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
  // The record's own quote timestamp, so the launch-time price is dated instead of reading as live.
  const launchDay = new Date((Number(q.publishTime) || 0) * 1000).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
  });
  const rows: Array<[string, string, string]> = [
    [
      "quote token",
      "the desk's own collateral class: a tokenized stock",
      LAUNCH.cluster === "mainnet" ? "TSLAx (xStocks), Meteora-badged" : "a devnet twin of TSLAx (8 dp)",
    ],
    [
      "opening value",
      `${usd(n.initialUsd)} fully diluted ÷ the quote stock's price`,
      `${fmtQ(n.initialMarketCapQuote)} at ${usd(q.usd)} — the launch-time quote (Pyth ${q.feed ?? "Crypto.TSLAX/USD"}, ${launchDay})`,
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
      `all trading fees and ${n.raiseToAgentPct} % of the raise → the agent's Clawpump wallet`,
      s
        ? s.feesToAgent === true
          ? "the agent claims the fees; the creator keeps none (verified on chain)"
          : s.feesToAgent === false
            ? s.config.feeClaimer !== (LAUNCH.agent?.walletAddress ?? "")
              ? `the claimer is ${s.config.feeClaimer.slice(0, 4)}…, not the agent`
              : `the creator keeps ${s.config.creatorTradingFeePercentage} % of the fee`
            : `claimer ${LAUNCH.feeClaimer.slice(0, 4)}…${LAUNCH.feeClaimer.slice(-4)} (no agent recorded)`
        : "reads from the pool",
    ],
    ["after graduation", "liquidity moves to DAMM v2", "both LP positions permanently locked (what graduate sends)"],
    [
      "supply",
      "fixed, no vesting",
      s
        ? `${s.supply.toLocaleString("en-US")} ${LAUNCH.token.symbol}, ${s.baseDecimals} decimals${s.scaledFromChain ? " (from the mint)" : " (planned)"}`
        : `${n.supply.toLocaleString("en-US")} ${LAUNCH.token.symbol} (planned)`,
    ],
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
          <span className="mono">plan.ts</span> builds the curve; <span className="mono">sdk.fetchDbc</span> decodes the
          raise, the fee schedule and who earns from the config account. The rest of the right-hand column is the launch
          record.
        </>
      }
    >
      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-left text-xs">
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
  // "identity coin live" used to mean "the record has a mint". Read the mint from mainnet in this
  // browser instead, so the badge is a fact about the chain and a judge can watch it answer.
  const coin = useMainnetMint(c?.mint);
  const checked = a?.checkedAt
    ? new Date(a.checkedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })
    : null;
  return (
    <Card
      eyebrow="Clawpump · identity and wallet"
      title={a ? a.name : "no Clawpump identity yet"}
      right={
        <span className="flex flex-wrap items-center gap-2">
          {a?.status === "running" ? (
            <Badge tone="good" icon="check">
              agent running{checked ? ` · checked ${checked}` : ""}
            </Badge>
          ) : a ? (
            <Badge tone="warn" icon="alert">
              agent {a.status ?? "status unknown"}
            </Badge>
          ) : null}
          {c && coin.data ? (
            <Badge tone="good" icon="check">
              identity coin on mainnet · {coin.data.supply.toLocaleString("en-US")} minted
            </Badge>
          ) : c ? (
            <Badge tone="mute">
              identity coin {coin.isError ? "— mainnet RPC did not answer" : "— reading mainnet…"}
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
          Two coins, two roles: the identity coin on pump.fun, the capital token on Meteora · this agent carries no
          persona. <DocLink to="TRACKS.md">the agent, in full →</DocLink>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="agent"
          value={a ? a.name : "—"}
          hint={
            a
              ? `Clawpump id ${a.id.slice(0, 8)}… · ${a.status === "running" ? "running — what Clawpump counts as deployed" : `status ${a.status ?? "unknown"}`}${checked ? `, as their API answered ${checked}` : ""}`
              : "run services/launch agent"
          }
        />
        <Stat
          label="wallet"
          value={a ? <ExplorerLink address={a.walletAddress} cluster="mainnet-beta" /> : "—"}
          hint="the pool's fee claimer and leftover receiver; pays its own pump.fun launch"
        />
        <Stat
          label="identity coin"
          value={c ? c.symbol : "—"}
          hint={
            c ? (
              <span className="flex flex-wrap gap-2">
                {a?.tokenAddress === c.mint && <span className="text-status-good">Clawpump points at this mint</span>}
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
        <p className="max-w-[44ch] text-sm text-ink-2">Every status below is read from a record or the chain.</p>
      </div>
      <Journey live={live} />
      <OnDesk />
      <BrowserAgent />
      {/* `page`: the numbers only. The agent's identity and its coin are the Clawpump card's job below,
          and the `card` variant would repeat both here — plus a footer linking to this very page. */}
      <LenderAgent variant="page" />
      <div className="grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <CurveFromDesk live={l.data} />
        <Clawpump />
      </div>
      <Card eyebrow="for developers" title="Read the pool the way the dashboard does">
        <div className="grid gap-3 lg:grid-cols-[1fr_auto] lg:items-start">
          <LenderTrack here="agent" />
          <p className="text-xs text-ink-3 lg:max-w-[28ch]">
            <Icon name="code" size={11} className="mr-1 inline" />
            Also the <span className="mono">launch-status</span> recipe, and{" "}
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

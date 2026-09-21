/**
 * The lender agent's token: a Meteora DBC pool quoted in a tokenized stock, configured from the
 * desk's numbers (services/launch). Progress to graduation, the raise in quote and USD (through the
 * same Pyth read the desk marks with), the fee in force right now, and the fee stream that is the
 * agent's revenue. Four states, each explicit: reading, the RPC did not answer, the pool is not on
 * chain (yet), and the numbers.
 */

import { dbcFeeAt } from "@thewindow/solana-sdk";
import { useEffect, useState } from "react";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { Skeleton } from "../../components/Skeleton";
import { Stat } from "../../components/Stat";
import { Badge, Button, ExplorerLink } from "../../components/ui";
import { formatAge, formatCountdown } from "../../lib/format";
import { LAUNCH, type LaunchState, launchCluster, tradeUrl, useLaunch } from "../../lib/launch";

const usd = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 4 : 0 })}`;
const q = (v: number) => `${v.toLocaleString("en-US", { maximumFractionDigits: 4 })} quote`;
const bp = (v: number) => (v >= 100 ? `${(v / 100).toFixed(2)} %` : `${v.toFixed(1)} bp`);

/** Wall-clock seconds, ticking once a second while mounted (the fee schedule steps on the clock). */
function useNowSecs() {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

function Stats({ s }: { s: LaunchState }) {
  const now = useNowSecs();
  const fee = dbcFeeAt(s.config.baseFee, s.pool.activationPoint, now);
  const schedule = `${LAUNCH.numbers.feeBps.open} → ${LAUNCH.numbers.feeBps.rest} bp over ${LAUNCH.numbers.feeBps.durationSecs / 3600} h`;
  const feeHint =
    fee.periodsLeft === 0
      ? `resting fee · the schedule ran ${schedule}`
      : `period ${fee.period} of ${s.config.baseFee.numberOfPeriod} · next step in ${formatCountdown(fee.secsToNext)} · ${schedule}`;
  const quoteHint = s.quoteFeed
    ? `Pyth ${s.quoteFeed}, ${formatAge(now - (s.quoteAgeSecs ?? 0), now * 1000)}`
    : "the launch-time price";
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        <Stat
          label="raised so far"
          value={q(s.raisedQuote)}
          hint={`${usd(s.raisedQuote * s.quoteUsd)} at ${usd(s.quoteUsd)} per quote · ${quoteHint}`}
        />
        <Stat
          label="graduation threshold"
          value={q(s.thresholdQuote)}
          hint={`${usd(s.thresholdQuote * s.quoteUsd)} · ${q(Math.max(0, s.thresholdQuote - s.raisedQuote))} to go`}
        />
        <Stat
          label="fee now"
          value={bp(fee.bps)}
          hint={feeHint}
          delta={fee.periodsLeft === 0 ? undefined : { value: `→ ${bp(fee.restingBps)}`, good: null }}
        />
        <Stat
          label={`${LAUNCH.token.symbol} fully diluted`}
          value={usd(s.spotQuote * s.quoteUsd * LAUNCH.numbers.supply)}
          hint={`spot ${s.spotQuote.toExponential(3)} quote · $${(s.spotQuote * s.quoteUsd).toPrecision(3)} per token`}
        />
        <Stat
          label="fees to the agent"
          value={q(s.creatorFeeQuote)}
          hint={`${q(s.totalFeeQuote)} traded in total · partner ${q(s.partnerFeeQuote)}`}
        />
      </div>
      <div className="mt-3">
        <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2" aria-hidden>
          <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.round(s.progress * 100)}%` }} />
        </div>
        <div className="mono mt-1 flex justify-between text-[10px] uppercase tracking-[0.14em] text-ink-3">
          <span>opened {formatAge(s.pool.activationPoint, now * 1000)}</span>
          <span>
            graduates at {q(s.thresholdQuote)} · {usd(s.thresholdQuote * s.quoteUsd)}
          </span>
        </div>
      </div>
    </>
  );
}

function AgentBlock({ s }: { s: LaunchState | null }) {
  const a = LAUNCH.agent;
  const c = LAUNCH.clawpump;
  if (!a && !c) return null;
  return (
    <div className="mt-3 grid gap-1 rounded-[var(--radius-sm)] border border-line bg-surface-0 p-2 text-xs text-ink-2">
      {a && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-3">the agent</span>
          <span className="text-ink-1">{a.name}</span>
          <span className="text-ink-3">· Clawpump wallet</span>
          <ExplorerLink address={a.walletAddress} cluster="mainnet-beta" />
          {s?.feesToAgent === true && (
            <Badge tone="good" icon="check">
              fees flow to the agent
            </Badge>
          )}
          {s?.feesToAgent === false && (
            <Badge tone="warn" icon="alert">
              creator or fee claimer is not the agent wallet
            </Badge>
          )}
        </div>
      )}
      {c && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-ink-3">its identity coin</span>
          <span className="mono text-ink-1">{c.symbol}</span>
          <span className="text-ink-3">launched by Clawpump on pump.fun, paired with TSLAx ·</span>
          <a href={c.pumpUrl} target="_blank" rel="noreferrer" className="text-accent hover:underline">
            pump.fun
          </a>
          <ExplorerLink address={c.mint} cluster="mainnet-beta">
            mint
          </ExplorerLink>
          <ExplorerLink address={c.txHash} cluster="mainnet-beta" kind="tx">
            launch tx
          </ExplorerLink>
        </div>
      )}
    </div>
  );
}

export function LenderAgent() {
  const l = useLaunch();
  const s = l.data?.kind === "ok" ? l.data.state : null;
  const rehearsal = LAUNCH.cluster !== "mainnet";
  const title = s
    ? s.pool.isMigrated
      ? "graduated · liquidity now on DAMM v2"
      : `${(s.progress * 100).toFixed(1)} % of the way to graduation`
    : l.isLoading
      ? "reading the pool…"
      : l.isError
        ? "the RPC did not answer"
        : l.data?.kind === "missing"
          ? "pool not on chain yet"
          : "pool unreadable";

  return (
    <Card
      eyebrow={`the lender agent · ${LAUNCH.token.symbol} on Meteora DBC · ${LAUNCH.cluster}`}
      title={title}
      right={
        <span className="flex flex-wrap items-center gap-2">
          {s &&
            (s.pool.isMigrated ? (
              <Badge tone="good" icon="check">
                graduated to DAMM v2
              </Badge>
            ) : s.pool.hasSwap ? (
              <Badge tone="accent">on the curve</Badge>
            ) : (
              <Badge tone="mute">on the curve · no trade yet</Badge>
            ))}
          {l.isError && (
            <Badge tone="warn" icon="alert">
              rpc busy
            </Badge>
          )}
          {rehearsal && <Badge tone="warn">devnet rehearsal · a twin quote, not TSLAx</Badge>}
          <ExplorerLink address={LAUNCH.pool} cluster={launchCluster}>
            pool
          </ExplorerLink>
          <ExplorerLink address={LAUNCH.baseMint} cluster={launchCluster}>
            {LAUNCH.token.symbol} mint
          </ExplorerLink>
          {tradeUrl && (
            <a
              href={tradeUrl}
              target="_blank"
              rel="noreferrer"
              className="text-xs text-accent hover:underline"
              title="swap the quote stock for the token on Jupiter"
            >
              trade →
            </a>
          )}
          {(l.isError || l.data?.kind === "missing") && (
            <Button variant="ghost" size="sm" icon="refresh" onClick={() => void l.refetch()} loading={l.isFetching}>
              refresh
            </Button>
          )}
        </span>
      }
      footer={
        <>
          The desk&apos;s lender is an autonomous agent: it lends every overnight window against tokenized-stock
          collateral proven solvent in zero knowledge and earns the xONIA rate. Its token launches on a Dynamic Bonding
          Curve quoted in a tokenized stock, and the curve is set from the desk&apos;s numbers — the raise target is{" "}
          {usd(LAUNCH.numbers.migrationUsd)} of fully diluted value converted into the quote stock through Pyth&apos;s
          read of the stock, the fee decays {LAUNCH.numbers.feeBps.open} → {LAUNCH.numbers.feeBps.rest} bp over one
          tenor ({LAUNCH.numbers.feeBps.durationSecs / 3600} h), every graduated LP position is locked for good, and{" "}
          {LAUNCH.numbers.creatorFeePct} % of the trading fee plus {LAUNCH.numbers.raiseToAgentPct} % of the raise go to
          the agent&apos;s wallet.
          {LAUNCH.clawpump
            ? " Clawpump's own launch venue is pump.fun, which is where the agent's identity coin lives; the Meteora pool is ours."
            : ""}{" "}
          Honest limit: the pool and its fees are real on the cluster named above; the lending loop the agent earns from
          is the devnet desk.
          {rehearsal ? " On devnet, `pnpm --filter @thewindow/launch buy 5` moves the curve." : ""}
        </>
      }
    >
      {s ? (
        <Stats s={s} />
      ) : l.isLoading ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {["raised", "threshold", "fee", "fdv", "fees"].map((k) => (
            <div key={k} className="grid gap-2">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-7 w-28" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))}
        </div>
      ) : l.isError ? (
        <EmptyState icon="alert" title="the RPC did not answer">
          The pool is read from {launchCluster} in this browser; the endpoint is rate-limited or down. Refresh, or set
          another RPC in Settings.
        </EmptyState>
      ) : l.data?.kind === "missing" ? (
        <EmptyState icon="clock" title="the pool is not on chain yet">
          The launch record names <span className="mono">{LAUNCH.pool}</span> on {launchCluster}, and no Meteora DBC
          account lives there. Either the launch has not run or this record is ahead of the chain.
        </EmptyState>
      ) : (
        <EmptyState icon="alert" title="the pool's numbers do not add up">
          The account decoded, but a threshold, a price or a reserve is not a finite positive number — check the launch
          record against the chain before trusting anything here.
        </EmptyState>
      )}
      <AgentBlock s={s} />
      <p className="mono mt-2 text-[11px] text-ink-3">
        config <ExplorerLink address={LAUNCH.config} cluster={launchCluster} /> · creator{" "}
        <ExplorerLink address={LAUNCH.creator} cluster={launchCluster} /> · quote{" "}
        <ExplorerLink address={LAUNCH.quote.mint} cluster={launchCluster} />
        {LAUNCH.txs.createConfigAndPool && (
          <>
            {" "}
            · launch tx <ExplorerLink address={LAUNCH.txs.createConfigAndPool} cluster={launchCluster} kind="tx" />
          </>
        )}
      </p>
    </Card>
  );
}

/**
 * The lender agent's token: a Meteora DBC pool quoted in a tokenized stock, configured from the
 * desk's numbers (services/launch). Progress to graduation, the raise in quote and USD (through the
 * same Pyth read the desk marks with), and the fee stream that is the agent's revenue.
 */

import { dbcPrice } from "@thewindow/solana-sdk";
import { Card } from "../../components/Card";
import { Stat } from "../../components/Stat";
import { Badge, ExplorerLink } from "../../components/ui";
import { LAUNCH, launchCluster, useLaunch } from "../../lib/launch";

const usd = (v: number) => `$${v.toLocaleString("en-US", { maximumFractionDigits: v < 10 ? 4 : 0 })}`;
const q = (v: number) => `${v.toLocaleString("en-US", { maximumFractionDigits: 4 })} quote`;

export function LenderAgent() {
  const l = useLaunch();
  const d = l.data ?? null;
  const price = d ? dbcPrice(d.pool.sqrtPrice, 6, LAUNCH.quote.decimals) : null;
  return (
    <Card
      eyebrow={`the lender agent · ${LAUNCH.token.symbol} on Meteora DBC · ${LAUNCH.cluster}`}
      title={
        d
          ? `${(d.progress * 100).toFixed(1)} % of the way to graduation`
          : l.isLoading
            ? "reading the pool…"
            : "pool not readable"
      }
      right={
        <span className="flex flex-wrap items-center gap-2">
          {d?.pool.isMigrated ? (
            <Badge tone="good">graduated to DAMM v2</Badge>
          ) : (
            <Badge tone="accent">on the curve</Badge>
          )}
          {LAUNCH.cluster !== "mainnet" && <Badge tone="warn">devnet rehearsal · a twin quote, not TSLAx</Badge>}
          <ExplorerLink address={LAUNCH.pool} cluster={launchCluster}>
            pool
          </ExplorerLink>
          <ExplorerLink address={LAUNCH.baseMint} cluster={launchCluster}>
            {LAUNCH.token.symbol} mint
          </ExplorerLink>
        </span>
      }
      footer={
        <>
          The desk&apos;s lender is an autonomous agent: it lends every overnight window against tokenized-stock
          collateral proven solvent in zero knowledge and earns the xONIA rate. Its token launches on a Dynamic Bonding
          Curve quoted in a tokenized stock, and the curve is set from the desk&apos;s numbers — the raise target is{" "}
          {usd(LAUNCH.numbers.migrationUsd)} of fully diluted value converted into the quote stock through Pyth&apos;s{" "}
          <span className="mono">Crypto.TSLAX/USD</span>, the fee decays {LAUNCH.numbers.feeBps.open} →{" "}
          {LAUNCH.numbers.feeBps.rest} bp over one tenor ({LAUNCH.numbers.feeBps.durationSecs / 3600} h), every
          graduated LP position is locked for good, and {LAUNCH.numbers.creatorFeePct} % of the trading fee plus{" "}
          {LAUNCH.numbers.raiseToAgentPct} % of the raise go to the agent&apos;s wallet
          {LAUNCH.agent ? ` (Clawpump agent ${LAUNCH.agent.name})` : ""}. Honest limit: the pool and its fees are real
          on the cluster named above; the lending loop the agent earns from is the devnet desk.
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="raised so far"
          value={d ? q(d.raisedQuote) : "—"}
          hint={d ? `${usd(d.raisedQuote * d.quoteUsd)} at ${usd(d.quoteUsd)} per quote` : undefined}
        />
        <Stat
          label="graduation threshold"
          value={d ? q(d.thresholdQuote) : "—"}
          hint={d ? usd(d.thresholdQuote * d.quoteUsd) : undefined}
        />
        <Stat
          label={`${LAUNCH.token.symbol} fully diluted`}
          value={price !== null && d ? usd(price * d.quoteUsd * LAUNCH.numbers.supply) : "—"}
          hint={
            price !== null && d
              ? `spot ${price.toExponential(3)} quote · $${(price * d.quoteUsd).toPrecision(3)} per token`
              : undefined
          }
        />
        <Stat
          label="fees to the agent"
          value={d ? q(d.creatorFeeQuote) : "—"}
          hint={d ? `${q(d.totalFeeQuote)} traded in total · partner ${q(d.partnerFeeQuote)}` : undefined}
        />
      </div>
      <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-surface-2">
        <div className="h-2 rounded-full bg-accent" style={{ width: `${Math.round((d?.progress ?? 0) * 100)}%` }} />
      </div>
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

/**
 * The third column of the tracks card: the lender agent's own token (Meteora DBC · Clawpump) as a
 * developer meets it — what it is, the live numbers, the SDK calls, the CLI, the honest limit. Reads the
 * same query as the Market card, so it costs no extra RPC.
 */
import { dbcFeeAt } from "@thewindow/solana-sdk";
import { CopyButton } from "../../components/DevConsole";
import { Icon } from "../../components/Icon";
import { Badge } from "../../components/ui";
import { LAUNCH, useLaunch } from "../../lib/launch";

const REPO = "https://github.com/kaustubh76/Blinds/blob/main";

function Snippet({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="mono overflow-x-auto rounded-[var(--radius-sm)] border border-line bg-surface-0 p-2 pr-16 text-[11px] leading-relaxed text-ink-2">
        {children}
      </pre>
      <div className="absolute top-1 right-1">
        <CopyButton text={children} />
      </div>
    </div>
  );
}

/**
 * `here = "build"` (the default) links out to the Agent page, which owns the long story.
 * `here = "agent"` is the same column *on* that page, so the links would point at itself — those go.
 */
export function LenderTrack({ here = "build" }: { here?: "build" | "agent" } = {}) {
  const l = useLaunch();
  const elsewhere = here !== "agent";
  const s = l.data?.kind === "ok" ? l.data.state : null;
  const fee = s ? dbcFeeAt(s.config.baseFee, s.pool.activationPoint, Math.floor(Date.now() / 1000)) : null;
  return (
    <div className="grid content-start gap-2 rounded-[var(--radius-md)] border border-line bg-surface-0 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone="lend">Meteora DBC · Clawpump</Badge>
        <span className="text-xs text-ink-3">the lender agent&apos;s own token</span>
      </div>
      <p className="text-xs text-ink-2">
        Read the pool from raw account bytes, with no Meteora SDK in the browser.{" "}
        {elsewhere && (
          <a href="#/agent" className="text-accent hover:underline">
            the agent page →
          </a>
        )}
      </p>
      <div className="text-xs">
        <div className="mono text-[10px] uppercase tracking-[0.14em] text-ink-3">the pool now · {LAUNCH.cluster}</div>
        {s && fee ? (
          <p className="mt-1 text-ink-2">
            <span className="num text-ink-1">{(s.progress * 100).toFixed(1)} %</span> to graduation ·{" "}
            {s.raisedQuote.toLocaleString("en-US", { maximumFractionDigits: 2 })} of{" "}
            {s.thresholdQuote.toLocaleString("en-US", { maximumFractionDigits: 2 })} quote · fee now{" "}
            {fee.bps >= 100 ? `${(fee.bps / 100).toFixed(2)} %` : `${fee.bps.toFixed(1)} bp`} (period {fee.period} of{" "}
            {s.config.baseFee.numberOfPeriod})
            {elsewhere && (
              <>
                {" · "}
                <a href="#/agent" className="text-accent hover:underline">
                  the agent page →
                </a>
              </>
            )}
          </p>
        ) : l.isError ? (
          <p className="mt-1 text-status-warning">the pool&apos;s RPC did not answer</p>
        ) : l.data?.kind === "missing" ? (
          <p className="mt-1 text-ink-3">pool not on chain yet</p>
        ) : (
          <p className="mt-1 text-ink-3">reading the pool…</p>
        )}
      </div>
      <Snippet>{`const { pool, config, progress } = await sdk.fetchDbc(rpc, address("${LAUNCH.pool}"));
const fee = sdk.dbcFeeAt(config.baseFee, pool.activationPoint, Math.floor(Date.now() / 1000));  // bps now, period, resting
const spot = sdk.dbcPrice(pool.sqrtPrice, 6, ${LAUNCH.quote.decimals});                          // quote per ${LAUNCH.token.symbol}
// the record: deployments/launch-${LAUNCH.cluster}.json · the operator's view: pnpm --filter @thewindow/launch status
// the curve's numbers come from services/launch/src/plan.ts (buildCurveWithMarketCap over the desk's targets)`}</Snippet>
      <p className="text-[11px] text-ink-3">
        <Icon name="alert" size={11} className="mr-1 inline text-status-warning" />
        Honest limit: real on {LAUNCH.cluster}; the loop it earns from is the devnet desk.{" "}
        <a className="underline" href={`${REPO}/docs/TRACKS.md`} target="_blank" rel="noreferrer">
          docs/TRACKS.md
        </a>{" "}
        Part B.
      </p>
    </div>
  );
}

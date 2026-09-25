/**
 * The two price tracks as a developer meets them: what each source is, how its quote reaches
 * the chain, what to call, and the honest limit. The Pyth column reads Pyth's own mainnet
 * accounts from this browser; the mark columns read the on-chain caches (their public APIs answer
 * no CORS preflight, so the keeper is the only thing that can read them).
 */
import { useQuery } from "@tanstack/react-query";
import { feedIdForLabel, fetchPrice, withRpcRetry } from "@thewindow/solana-sdk";
import type { ReactNode } from "react";
import { Card } from "../../components/Card";
import { CopyButton } from "../../components/DevConsole";
import { Icon } from "../../components/Icon";
import { Badge, DocLink, ExplorerLink, type Tone } from "../../components/ui";
import { config } from "../../config";
import { rpc } from "../../lib/chain";
import { basisBps, FEEDS, fetchFreshest, formatBasis, mainnetRpc, nyseSession } from "../../lib/pyth";
import { useDeployment } from "../../lib/queries";
import { LenderTrack } from "./LenderTrack";

const age = (s: number) => (s < 120 ? `${s} s` : s < 7200 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`);
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

function Column({ title, tone, sub, children }: { title: string; tone: Tone; sub: string; children: ReactNode }) {
  return (
    <div className="grid content-start gap-2 rounded-[var(--radius-md)] border border-line bg-surface-0 p-3">
      <div className="flex items-center gap-2">
        <Badge tone={tone}>{title}</Badge>
        <span className="text-xs text-ink-3">{sub}</span>
      </div>
      {children}
    </div>
  );
}

function usePythMainnet() {
  return useQuery({
    queryKey: ["build-pyth-mainnet"],
    queryFn: async () => {
      const [wrapper, equity] = await Promise.all([
        fetchFreshest(mainnetRpc, FEEDS["Crypto.TSLAX/USD"]),
        fetchFreshest(mainnetRpc, FEEDS["Equity.US.TSLA/USD"]),
      ]);
      const now = Math.floor(Date.now() / 1000);
      return {
        wrapper: wrapper ? { ...wrapper, ageSecs: Math.max(0, now - wrapper.publishTime) } : null,
        equity: equity ? { ...equity, ageSecs: Math.max(0, now - equity.publishTime) } : null,
        basis: wrapper && equity ? basisBps(wrapper, equity) : null,
        session: nyseSession().label,
      };
    },
    refetchInterval: 60_000,
    retry: 1,
  });
}

function useMark(label: string) {
  return useQuery({
    queryKey: ["build-mark", label],
    queryFn: async () => {
      const feedId = await feedIdForLabel(label);
      const price = await withRpcRetry(() => fetchPrice(rpc, feedId));
      if (!price) return null;
      return {
        mark: Number(price.price) * 10 ** price.expo,
        ageSecs: Math.max(0, Math.floor(Date.now() / 1000) - Number(price.publishTime)),
        posts: Number(price.posts),
      };
    },
    refetchInterval: 60_000,
  });
}

export function Tracks() {
  const dep = useDeployment();
  const pyth = usePythMainnet();
  const prestocks = useMark("prestocks:ANTHROPIC");
  const by = (source: string) => dep.data?.listings.find((l) => l.source === source);
  const lp = by("pyth");
  const lps = by("prestocks");
  const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

  return (
    <Card
      eyebrow="the tracks · how to integrate against each"
      title="One rate, two ways a mark reaches the chain"
      footer={
        <span>
          Record and evidence:{" "}
          <a className="underline" href={`${REPO}/docs/TRACKS.md`} target="_blank" rel="noreferrer">
            docs/TRACKS.md
          </a>{" "}
          ·{" "}
          <a className="underline" href={`${REPO}/docs/PYTH.md`} target="_blank" rel="noreferrer">
            PYTH.md
          </a>{" "}
          ·{" "}
          <a className="underline" href={`${REPO}/docs/LISTINGS.md`} target="_blank" rel="noreferrer">
            LISTINGS.md
          </a>{" "}
          ·{" "}
          <a className="underline" href={`${REPO}/docs/project.excalidraw`} target="_blank" rel="noreferrer">
            project.excalidraw
          </a>{" "}
          (the whole product on one canvas).
        </span>
      }
    >
      <div className="grid gap-3 lg:grid-cols-3">
        <Column title="Pyth" tone="accent" sub="the mark is a coefficient in the proof">
          <p className="text-xs text-ink-2">
            Every lock proves <span className="mono">collateral × price × multiplier ≥ haircut × loan</span> over
            ciphertexts, with Pyth&apos;s quote as <span className="mono">k_c</span>.
          </p>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-[11px] text-ink-3">
            <dt className="mono text-ink-2">source 0</dt>
            <dd>the keeper copies Hermes into the listing&apos;s cache</dd>
            <dt className="mono text-ink-2">source 4</dt>
            <dd>the program reads Pyth&apos;s own account — no copy</dd>
          </dl>
          <div className="text-xs">
            <div className="mono text-[10px] uppercase tracking-[0.14em] text-ink-3">
              read from mainnet in this browser
            </div>
            {pyth.data ? (
              <ul className="mt-1 grid gap-0.5 text-ink-2">
                <li>
                  Crypto.TSLAX/USD{" "}
                  {pyth.data.wrapper ? (
                    <>
                      <span className="num text-ink-1">
                        {usd(Number(pyth.data.wrapper.price) * 10 ** pyth.data.wrapper.expo)}
                      </span>{" "}
                      · published {age(pyth.data.wrapper.ageSecs)} ago · {pyth.data.wrapper.verification} ·{" "}
                      <ExplorerLink address={pyth.data.wrapper.account} cluster="mainnet-beta" />
                    </>
                  ) : (
                    "no account"
                  )}
                </li>
                <li>
                  Equity.US.TSLA/USD{" "}
                  {pyth.data.equity ? (
                    <>
                      <span className="num text-ink-1">
                        {usd(Number(pyth.data.equity.price) * 10 ** pyth.data.equity.expo)}
                      </span>{" "}
                      · published {age(pyth.data.equity.ageSecs)} ago · {pyth.data.session}
                    </>
                  ) : (
                    "no account"
                  )}
                </li>
                {pyth.data.basis !== null && <li>wrapper basis {formatBasis(pyth.data.basis)}</li>}
              </ul>
            ) : pyth.isError ? (
              <p className="mt-1 text-status-warning">mainnet RPC did not answer</p>
            ) : (
              <p className="mt-1 text-ink-3">reading Pyth's accounts…</p>
            )}
          </div>
          {lp && (
            <p className="text-xs text-ink-3">
              listing <ExplorerLink address={lp.listing} cluster={config.cluster} /> · haircut{" "}
              {Number(lp.haircutBps) / 100}% · quote limit {age(lp.maxPublishAgeSecs)}
            </p>
          )}
          <Snippet>{`const l = await sdk.fetchListing(rpc, "${lp?.cstockMint ?? "<cstockMint>"}");
const q = await sdk.fetchQuote(rpc, {                            // { price, expo, publishTime, postedSlot, from }
  feedId: new Uint8Array(l.feedId), priceSource: l.priceSource,  // source 0: the cache PDA; source 4: the Pyth
  priceAccount: ${lp?.priceAccount ? `"${lp.priceAccount}"` : "null"},${lp?.priceAccount ? "" : "                                            "} // account (descriptor price_account)
});
// browser-side, Pyth's own mainnet account (see the "pyth-mainnet" recipe): fetchFreshest(mainnetRpc, FEEDS["Crypto.TSLAX/USD"])`}</Snippet>
          <p className="text-[11px] text-ink-3">
            <Icon name="alert" size={11} className="mr-1 inline text-status-warning" />
            Honest limit: with no Pyth key the chain refuses TSLAx locks — inaction, never a stale mark.{" "}
            <DocLink to="PYTH.md">why →</DocLink>
          </p>
        </Column>

        <Column title="PreStocks" tone="borrow" sub="ANTHROPIC · pre-IPO, an attested mark">
          <p className="text-xs text-ink-2">
            A pre-IPO token beside a listed stock, under one rate · the keeper posts its{" "}
            <span className="mono">markPrice</span>.
          </p>
          <div className="text-xs">
            <div className="mono text-[10px] uppercase tracking-[0.14em] text-ink-3">on-chain cache now</div>
            {prestocks.data ? (
              <p className="mt-1 text-ink-2">
                <span className="num text-ink-1">{usd(prestocks.data.mark)}</span> · fetched{" "}
                {age(prestocks.data.ageSecs)} ago · {prestocks.data.posts} posts · limit 48 h
              </p>
            ) : prestocks.data === null ? (
              <p className="mt-1 text-ink-3">no cache yet</p>
            ) : (
              <p className="mt-1 text-ink-3">reading…</p>
            )}
          </div>
          {lps && (
            <p className="text-xs text-ink-3">
              listing <ExplorerLink address={lps.listing} cluster={config.cluster} /> · escrow{" "}
              <ExplorerLink address={lps.escrow} cluster={config.cluster} /> · haircut {Number(lps.haircutBps) / 100}%
            </p>
          )}
          <Snippet>{`const feedId = await sdk.feedIdForLabel("prestocks:ANTHROPIC");
const q = await sdk.fetchPrice(rpc, feedId);
// lock against this listing (reads the quote where the program does, proves, retries once if it moved):
// sdk.lockCollateral(rpc, { ..., listing: "${lps?.listing ?? "<listing>"}", quote: { feedId, priceSource: l.priceSource }, mockMint: "${lps?.mockMint ?? "<mockMint>"}", haircutBps: ${lps ? lps.haircutBps.toString() : "20000"}n, rent })
// curl -s https://prestocks.com/api/prestocks | jq '.[] | select(.contract_address=="Pren1FvFX6J3E4kXhJuCiAD5aDmGEb7qJRncwA8Lkhw") | {markPrice, tokenPrice}'`}</Snippet>
          <p className="text-[11px] text-ink-3">
            Honest limit: attested by the keeper, not a signed feed; stamped at fetch and bounded at 48 h.{" "}
            <DocLink to="LISTINGS.md">why →</DocLink>
          </p>
        </Column>
        <LenderTrack />
      </div>
    </Card>
  );
}

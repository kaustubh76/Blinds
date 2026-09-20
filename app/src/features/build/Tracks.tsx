/**
 * The three price tracks as a developer meets them: what each source is, how its quote reaches
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
import { Badge, ExplorerLink, type Tone } from "../../components/ui";
import { config } from "../../config";
import { rpc } from "../../lib/chain";
import { basisBps, FEEDS, fetchFreshest, formatBasis, mainnetRpc, nyseSession } from "../../lib/pyth";
import { useDeployment } from "../../lib/queries";

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
  const tessera = useMark("tessera:T-OpenAI");
  const prestocks = useMark("prestocks:ANTHROPIC");
  const by = (source: string) => dep.data?.listings.find((l) => l.source === source);
  const lp = by("pyth");
  const lt = by("tessera");
  const lps = by("prestocks");
  const usd = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

  return (
    <Card
      eyebrow="the three tracks · how to integrate against each"
      title="One rate, three ways a mark reaches the chain"
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
          </a>
          . The administrator can decrypt individual amounts (accountable privacy); the tokens on devnet are mock twins.
        </span>
      }
    >
      <div className="grid gap-3 lg:grid-cols-3">
        <Column title="Pyth" tone="accent" sub="the mark is a coefficient in the proof">
          <p className="text-xs text-ink-2">
            Every lock proves <span className="mono">collateral × price × multiplier ≥ haircut × loan</span> over
            ciphertexts; <span className="mono">k_c</span> is Pyth's quote. Two paths: under{" "}
            <span className="mono">price_source = 0</span> the keeper copies Hermes (with a key, else Pyth's on-chain
            push account) into the listing's cache with the quote's own <span className="mono">publish_time</span>
            {"; "}under <span className="mono">price_source = 4</span> the program reads the receiver-owned{" "}
            <span className="mono">PriceUpdateV2</span> account our poster carries onto devnet — no keeper copy in the
            path. Either way the quote's age is enforced at lock and seize.
          </p>
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
            Honest limit: every Pyth HTTP endpoint needs a key and this feed's only push account stopped on 12 Sep;
            without a key the keeper reposts the old quote and the chain refuses TSLAx locks (QuoteStale) — inaction,
            never a stale mark.
          </p>
        </Column>

        <Column title="Tessera" tone="lend" sub="T-OpenAI · pre-IPO, an attested mark">
          <p className="text-xs text-ink-2">
            A confidential borrow line against a pre-IPO token: wrap into the confidential mint, prove solvency at 200 %
            against Tessera's mark, borrow at the print. The keeper copies <span className="mono">markPrice</span> from
            the public API and posts it with its <em>fetch time</em> as <span className="mono">publish_time</span>;{" "}
            <span className="mono">price_source = 1</span> says so on chain.
          </p>
          <div className="text-xs">
            <div className="mono text-[10px] uppercase tracking-[0.14em] text-ink-3">on-chain cache now</div>
            {tessera.data ? (
              <p className="mt-1 text-ink-2">
                <span className="num text-ink-1">{usd(tessera.data.mark)}</span> · fetched {age(tessera.data.ageSecs)}{" "}
                ago · {tessera.data.posts} posts · limit 48 h
              </p>
            ) : tessera.data === null ? (
              <p className="mt-1 text-ink-3">no cache yet</p>
            ) : (
              <p className="mt-1 text-ink-3">reading…</p>
            )}
          </div>
          {lt && (
            <p className="text-xs text-ink-3">
              listing <ExplorerLink address={lt.listing} cluster={config.cluster} /> · escrow{" "}
              <ExplorerLink address={lt.escrow} cluster={config.cluster} /> · haircut {Number(lt.haircutBps) / 100}%
            </p>
          )}
          <Snippet>{`const feedId = await sdk.feedIdForLabel("tessera:T-OpenAI");   // sha256 label, never a Pyth id
const q = await sdk.fetchPrice(rpc, feedId);
// the keeper's side (no CORS on the API — a browser cannot fetch it):
// curl -s https://rest-api.tessera.pe/v1/public/token-details | jq '.[] | select(.mint=="oPAiAikWTaFj9RYoRFD35ccfwhnMcB3ThgBZRHSkjTZ").markPrice'`}</Snippet>
          <p className="text-[11px] text-ink-3">
            Honest limit: a copy of a public mark, not a signed feed. If the API stops, the last good mark is re-posted
            for 6 h, then the 48 h rule halts new locks on this listing.
          </p>
        </Column>

        <Column title="PreStocks" tone="borrow" sub="ANTHROPIC · pre-IPO, an attested mark">
          <p className="text-xs text-ink-2">
            The same desk lists ANTHROPIC next to a listed stock and a Tessera token under one rate — a collateral
            schedule. PreStocks publishes a <span className="mono">markPrice</span> and a{" "}
            <span className="mono">tokenPrice</span>; the keeper posts the mark (
            <span className="mono">price_source = 2</span>) and the Market shows the implied-vs-mark basis.
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
            Honest limit: as for Tessera — attested by the keeper, stamped at fetch, bounded by the on-chain 48 h rule.
          </p>
        </Column>
      </div>
    </Card>
  );
}

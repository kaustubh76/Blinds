/**
 * Build: the page for the developer who wants to hook in. Live recipes that run here against the
 * configured RPC (and copy as code), the programs' surface from their IDLs, the PDA seeds, the
 * app's hooks, the admin service's API, and the DevTools handle.
 */
import * as sdk from "@thewindow/solana-sdk";
import type { UiWalletAccount } from "@wallet-standard/react";
import { useRef, useState } from "react";
import { Card } from "../../components/Card";
import { CopyButton } from "../../components/DevConsole";
import { Icon } from "../../components/Icon";
import { Badge, Button, ExplorerLink, Note } from "../../components/ui";
import { config } from "../../config";
import { rentFor, rpc } from "../../lib/chain";
import { devConsole, jsonSafe } from "../../lib/console";
import { capitalize, countWord } from "../../lib/format";
import { useDeployment, useOracle } from "../../lib/queries";
import { type RpcCall, rpcTap } from "../../lib/rpcTap";
import { useSession } from "../../lib/wallet";
import { useDesk } from "../desk/useDesk";
import { Inspector, InspectorToggle } from "./Inspector";
import { ProgramSurface } from "./ProgramSurface";
import { ParamFields, storedValues } from "./params";
import { type Desk, makeParams, RECIPES, type Recipe, type RecipeCtx } from "./recipes";
import { Schedule } from "./Schedule";
import { Scratchpad } from "./Scratchpad";
import { Tracks } from "./Tracks";

function Code({ children }: { children: string }) {
  return (
    <div className="relative">
      <pre className="mono overflow-x-auto rounded-[var(--radius-md)] border border-line bg-surface-0 p-3 text-[11.5px] leading-relaxed text-ink-1">
        {children}
      </pre>
      <div className="absolute top-1.5 right-1.5">
        <CopyButton text={children} />
      </div>
    </div>
  );
}

/**
 * `useDesk` needs an account, and hooks cannot be conditional — so the desk handle is made in a leaf
 * that is mounted only when there is one. `RecipeCard` takes it as a prop and does not care which.
 */
function WithDesk({ account, children }: { account: UiWalletAccount; children: (d: Desk) => React.ReactNode }) {
  const d = useDesk(account);
  return <>{children(d)}</>;
}

/**
 * Both recipe cards and the scratchpad, sharing one desk handle: `useDesk` holds mutations, and two
 * copies of it would be two sets of in-flight state for the same wallet.
 */
function Recipes() {
  const s = useSession();
  const body = (desk: Desk | null) => <RecipeSections desk={desk} />;
  return s.account ? <WithDesk account={s.account}>{(d) => body(d)}</WithDesk> : body(null);
}

function RecipeSections({ desk }: { desk: Desk | null }) {
  const reads = RECIPES.filter((r) => !r.writes);
  const writes = RECIPES.filter((r) => r.writes);
  // The snippet the scratchpad loads: whichever recipe you looked at last, defaulting to the first.
  const [seedId, setSeedId] = useState(reads[0]?.id ?? "");
  const seed = RECIPES.find((r) => r.id === seedId) ?? reads[0];
  return (
    <>
      <Card
        eyebrow="live recipes · reads"
        title="Run it here, copy it as code"
        footer="Change a parameter and both the snippet and the run follow it. Secrets are never rendered."
      >
        <ul className="grid gap-3">
          {reads.map((r) => (
            <RecipeCard key={r.id} r={r} desk={desk} onFocus={() => setSeedId(r.id)} />
          ))}
        </ul>
      </Card>

      <Card
        eyebrow="live recipes · writes"
        title="Drive the desk from here"
        footer="The Desk's own flows, so a bid sealed here is the same on chain. Never auto-retried."
      >
        <Note tone="warn">
          These cost fees on <span className="mono">{config.cluster}</span>. Each asks once; each has a dry run that
          builds the plan and sends nothing.
        </Note>
        <ul className="mt-3 grid gap-3">
          {writes.map((r) => (
            <RecipeCard key={r.id} r={r} desk={desk} onFocus={() => setSeedId(r.id)} />
          ))}
        </ul>
      </Card>

      <Card
        eyebrow="scratchpad"
        title="Edit it and run it"
        footer="The real SDK against your configured RPC. Nothing leaves the browser."
      >
        <Scratchpad seed={seed ? seed.code(scratchCtx(seed, desk)) : ""} desk={desk} />
      </Card>
    </>
  );
}

/**
 * A context for rendering a snippet outside a card — parameters at their stored values, no abort signal
 * to speak of, and nothing that runs.
 */
function scratchCtx(r: Recipe, desk: Desk | null): RecipeCtx {
  return {
    sdk,
    rpc,
    config,
    deployment: null,
    wallet: null,
    memberSignature: null,
    rentFor,
    signal: new AbortController().signal,
    log: () => {},
    p: makeParams(r.params, storedValues(r.id, r.params)),
    desk,
    dryRun: true,
  };
}

function RecipeCard({ r, desk, onFocus }: { r: Recipe; desk: Desk | null; onFocus?: () => void }) {
  const s = useSession();
  const dep = useDeployment();
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [showCode, setShowCode] = useState(false);
  const [values, setValues] = useState(() => storedValues(r.id, r.params));
  const [armed, setArmed] = useState(false);
  const [wire, setWire] = useState(false);
  const [calls, setCalls] = useState<readonly RpcCall[]>([]);
  const ctrl = useRef<AbortController | null>(null);

  const ctxFor = (over: { signal?: AbortSignal; dryRun?: boolean } = {}): RecipeCtx => ({
    sdk,
    rpc,
    config,
    deployment: dep.data ?? null,
    wallet: s.address,
    memberSignature: s.memberSignature,
    rentFor,
    signal: over.signal ?? ctrl.current?.signal ?? new AbortController().signal,
    log: (line) => setLines((l) => [...l, line]),
    p: makeParams(r.params, values),
    desk,
    dryRun: over.dryRun ?? false,
  });
  const ctx = ctxFor();
  // `me` reads any address that is typed in, so it is only blocked when there is neither.
  const hasSubject = !!s.address || !!values.wallet?.trim();
  const blocked =
    r.needs === "wallet" && !hasSubject
      ? "connect a wallet or take a burner"
      : r.needs === "keys" && !s.memberSignature
        ? 'derive your keys first — the "derive-keys" recipe does it here'
        : r.writes && !desk
          ? "connect a wallet or take a burner"
          : null;

  const run = async (opts: { dryRun?: boolean } = {}) => {
    const c = new AbortController();
    ctrl.current = c;
    setRunning(true);
    setLines([]);
    setOut(null);
    setErr(null);
    setCalls([]);
    setArmed(false);
    const t0 = performance.now();
    const runCtx = ctxFor({ signal: c.signal, ...(opts.dryRun ? { dryRun: true } : {}) });
    const id = devConsole.push({
      kind: "call",
      title: `recipe: ${r.title}${opts.dryRun ? " (dry run)" : ""}`,
      code: r.code(runCtx),
      state: "pending",
    });
    if (wire) rpcTap.start();
    try {
      // The public devnet RPC answers 429 when the market, the agents and a browser share one IP; a
      // read recipe is idempotent, so retry the whole run a few times before showing the error. A
      // write recipe is *not* retried: re-running half a sent plan is how you send a bid twice.
      const attempts = r.writes ? 1 : 4;
      let v: unknown;
      for (let attempt = 1; ; attempt++) {
        try {
          v = await r.run(runCtx);
          break;
        } catch (e) {
          if (attempt >= attempts || c.signal.aborted || !ctx.sdk.isTransientRpcError(e)) throw e;
          setLines((l) => [...l, `the RPC did not answer (rate limit) — retrying (${attempt}/${attempts - 1})`]);
          await new Promise((res) => setTimeout(res, 1500 * attempt));
        }
      }
      setOut(jsonSafe(v));
      devConsole.update(id, { state: "confirmed", detail: v });
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e);
      setErr(m);
      devConsole.update(id, { state: "failed", error: m });
    } finally {
      if (wire) setCalls(rpcTap.stop());
      setMs(Math.round(performance.now() - t0));
      setRunning(false);
      ctrl.current = null;
    }
  };

  return (
    <li data-recipe={r.id} className="rounded-[var(--radius-lg)] border border-line bg-surface-1 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="text-left text-sm font-medium text-ink-1 hover:text-accent"
          onClick={() => {
            setShowCode((v) => !v);
            onFocus?.();
          }}
          title="show this recipe's code, and load it into the scratchpad below"
        >
          {r.title}
        </button>
        {r.writes && (
          <Badge tone="warn" icon="alert">
            writes
          </Badge>
        )}
        {r.needs && <Badge tone={blocked ? "warn" : "good"}>{r.needs === "wallet" ? "wallet" : "keys"}</Badge>}
        {ms !== null && !running && <span className="mono text-[11px] text-ink-3">{ms} ms</span>}
        <span className="ml-auto flex items-center gap-1">
          <InspectorToggle on={wire} onChange={setWire} />
          <Button variant="ghost" size="sm" icon="code" onClick={() => setShowCode((v) => !v)}>
            {showCode ? "hide code" : "code"}
          </Button>
          {running ? (
            <Button variant="ghost" size="sm" icon="stop" onClick={() => ctrl.current?.abort()}>
              abort
            </Button>
          ) : r.writes ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                icon="shield"
                onClick={() => void run({ dryRun: true })}
                disabled={!!blocked}
                title="build everything this would send, and send none of it"
              >
                dry run
              </Button>
              <Button
                size="sm"
                variant={armed ? "danger" : "primary"}
                icon={armed ? "alert" : "play"}
                onClick={() => (armed ? void run() : setArmed(true))}
                disabled={!!blocked}
                {...(blocked ? { title: blocked } : {})}
              >
                {armed ? "really send" : "run here"}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              icon="play"
              onClick={() => void run()}
              disabled={!!blocked}
              {...(blocked ? { title: blocked } : {})}
            >
              run here
            </Button>
          )}
        </span>
      </div>
      <p className="mt-1 text-xs text-ink-2">{r.blurb}</p>
      {blocked && <p className="mt-1 text-xs text-status-warning">{blocked}</p>}
      {armed && !running && (
        <p className="mt-1 text-xs text-status-warning">
          This sends transactions signed by {s.wallet?.name === "Devnet burner" ? "your burner" : "your wallet"} on{" "}
          <span className="mono">{config.cluster}</span>. Press again to go ahead.
        </p>
      )}
      {r.params && r.params.length > 0 && (
        <ParamFields recipeId={r.id} specs={r.params} values={values} onChange={setValues} ctx={ctx} />
      )}
      {showCode && (
        <div className="mt-3">
          <Code>{r.code(ctx)}</Code>
        </div>
      )}
      {lines.length > 0 && (
        <ul className="mono mt-3 grid gap-0.5 text-[11px] text-ink-3">
          {lines.map((l, i) => (
            <li key={`${l}#${lines.slice(0, i).filter((x) => x === l).length}`}>› {l}</li>
          ))}
        </ul>
      )}
      {err && <p className="mt-2 text-xs text-status-critical">{err}</p>}
      {out && (
        <pre className="mono mt-3 max-h-72 overflow-auto rounded-[var(--radius-md)] border border-line bg-surface-0 p-3 text-[11px] leading-relaxed text-ink-2">
          {out}
        </pre>
      )}
      <Inspector calls={calls} />
    </li>
  );
}

const PDA_SEEDS: Array<[string, string, string]> = [
  ["registry", "config", '["config"]'],
  ["registry", "member(owner)", '["member", owner]'],
  ["auction", "auctionConfig", '["config"]'],
  ["auction", "epoch(index)", '["epoch", u64le(index)]'],
  ["auction", "bid(epoch, owner, side, tick)", '["bid", u64le(epoch), owner, side, tick]'],
  ["oracle", "oracleState", '["oracle"]'],
  ["oracle", "print(index)", '["print", u64le(index)]'],
  ["oracle", "oracleAuthority", '["authority"]'],
  ["wrap", "wrapVault(mockMint)", '["vault", mockMint]'],
  ["wrap", "wrapMintAuthority", '["mint_authority"]'],
  ["credit", "creditConfig", '["config"]'],
  ["credit", "listing(cstockMint)", '["listing", cstockMint]'],
  [
    "credit",
    "priceCache(feedId)",
    '["price", feedId]  — feedId: a Pyth id, or sha256("<source>:<symbol>") for an attested mark',
  ],
  ["credit", "loan(epoch, borrower, bidTick, k)", '["loan", u64le(epoch), borrower, bidTick, k]'],
];

const HOOKS: Array<[string, string]> = [
  ["useAuctionConfig / useCreditConfig / useOracle", "the three config accounts, polled on the slot clock"],
  ["useEpoch(index) / usePrint(index) / useSeries(latest, n)", "one epoch's accumulators, its print, the print series"],
  [
    "useQuote(listing) / usePrices(listings) / useMultiplier(mint)",
    "a quote read where the program reads it, and the mint's multiplier",
  ],
  ["useOnChainListings() / useSelectedListing()", "the schedule as the chain has it · the listing the Desk is working"],
  ["useUnderlying(feedId)", "Pyth's mainnet push-oracle account, read in the browser"],
  ["useMember(owner) / useBids(wallet) / useLoans(wallet)", "membership (public), sealed bids, loans on both sides"],
  ["useTokenAccounts(wallet, mock, cstock)", "the two ATAs and the confidential-extension view"],
  ["useWindowClock()", "phase, progress, seconds left — the ring's single source of truth"],
  ["useDesk(account)", "deriveKeys · join · onboard · wrap · applyPending · bid (mutations) + decrypted balances"],
  ["usePositions(account)", "lock (priced solvency proof) · deposit (confidential transfer to escrow)"],
  ["useVerify(print)", "verifyPrint with per-stage timing → a verdict"],
  ["useConsole() / useLiveEvents()", "the developer console store · the WebSocket layer's state and last events"],
  ["useBackdrop() / backdrop.pulse(kind)", "what the field behind the page is told · one impulse on top of it"],
];

export function Build() {
  const dep = useDeployment();
  const oracle = useOracle();
  const admin = dep.data?.adminUrl ?? config.adminUrl ?? "";
  const adminShown = admin || "http://127.0.0.1:9090";
  // The DevTools sample is meant to be pasted and run, so it names this market's own last print and
  // one of its own listings rather than whichever epoch and mint were live when it was written.
  const sampleEpoch = oracle.data?.hasPrinted ? oracle.data.lastPrintEpoch.toString() : "0";
  const sampleListing = dep.data?.listings.at(-1);
  return (
    <div className="grid gap-4">
      <Card
        eyebrow="build on it"
        title="Everything on this page runs from the chain and the SDK — nothing here trusts this site."
        right={<Badge tone="accent">for developers</Badge>}
      >
        <div className="grid gap-3 text-sm text-ink-2 md:grid-cols-[1.2fr_1fr]">
          <div>
            <p>
              <span className="mono">@thewindow/solana-sdk</span> — generated clients, plans, rates and the wasm proof
              engine. Not on npm: use it from the repo.
            </p>
            <div className="mt-3">
              <Code>{`git clone https://github.com/kaustubh76/Blinds && cd Blinds
pnpm install && pnpm --filter @thewindow/solana-sdk build
# in your project:
pnpm add file:../Blinds/sdk @solana/kit`}</Code>
            </div>
          </div>
          <div>
            <div className="mono text-[11px] uppercase tracking-[0.14em] text-ink-3">this page's endpoints</div>
            <dl className="mt-1 grid gap-1 text-xs">
              <div className="flex gap-2">
                <dt className="w-16 text-ink-3">rpc</dt>
                <dd className="mono">{config.rpcUrl}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 text-ink-3">ws</dt>
                <dd className="mono">{config.wsUrl}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 text-ink-3">admin</dt>
                <dd className="mono">{admin || "— (not configured)"}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-16 text-ink-3">cluster</dt>
                <dd className="mono">{config.cluster}</dd>
              </div>
            </dl>
            <div className="mono mt-3 text-[11px] uppercase tracking-[0.14em] text-ink-3">programs</div>
            <ul className="mt-1 grid gap-0.5 text-xs">
              {(Object.keys(sdk.PROGRAMS) as Array<keyof typeof sdk.PROGRAMS>).map((k) => (
                <li key={k} className="flex min-w-0 items-baseline gap-2">
                  <span className="w-16 shrink-0 text-ink-3">{k}</span>
                  <span className="min-w-0 break-all">
                    <ExplorerLink address={sdk.PROGRAMS[k]} cluster={config.cluster}>
                      {sdk.PROGRAMS[k]}
                    </ExplorerLink>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      <Card
        eyebrow="the collateral schedule · live"
        title="The listings, one rate — what the chain would accept right now"
      >
        <Schedule />
      </Card>

      <Tracks />

      <Recipes />

      <Card
        eyebrow="program surface"
        title={`${capitalize(countWord(Object.keys(sdk.PROGRAMS).length))} programs, from their IDLs`}
      >
        <ProgramSurface />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card eyebrow="pdas" title="Seeds (sdk.pda.*)">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-xs">
              <tbody>
                {PDA_SEEDS.map(([p, fn, seeds]) => (
                  <tr key={fn} className="border-b border-line/60 last:border-0">
                    <td className="py-1 pr-2 text-ink-3">{p}</td>
                    <td className="mono py-1 pr-2 text-ink-1">{fn}</td>
                    <td className="mono py-1 text-ink-2">{seeds}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card
          eyebrow="hooks"
          title="The hooks this app is built from"
          footer="Reads live in lib/queries.ts; writes in useDesk and usePositions."
        >
          <dl className="grid gap-1.5 text-xs">
            {HOOKS.map(([h, d]) => (
              <div key={h}>
                <dt className="mono text-ink-1">{h}</dt>
                <dd className="text-ink-3">{d}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card eyebrow="admin service" title="The one off-chain API (demo faucet + descriptor)">
          <Note>
            The app needs it only for <span className="mono">POST /join</span>, which is rate limited.
          </Note>
          <div className="mt-3">
            <Code>{`GET  ${adminShown}/healthz      → ok
GET  ${adminShown}/deployment   → { cluster, programs, listings[] { key, symbol, source, listing, mock_mint, cstock_mint, escrow_account, feed_id_hex, haircut_bps, max_price_age_slots, max_publish_age_secs, price_source?, price_account? }, auditor_elgamal_pubkey_hex, agents[] }
GET  ${adminShown}/faucet       → { remaining_this_hour, max_per_hour, min_balance_sol }
GET  ${adminShown}/metrics      → prometheus text
POST ${adminShown}/join
     { "wallet": "<base58>", "elgamal_pubkey_hex": "<64 hex>", "mock_account": "<base58 ATA>" }
     → 200 { "ok": true, "signature": "<sig>" | null, "already_member": bool }
     → 400 { "ok": false, "error": "…" } · 429 busy (retry_after_secs) · 503 balance floor

curl -s -X POST ${adminShown}/join -H 'content-type: application/json' \\
  -d '{"wallet":"<base58>","elgamal_pubkey_hex":"<hex>","mock_account":"<base58>"}'

# operator-side, no transaction: every listing's source, mark and quote age / what the chain would accept now
./target/release/window-admin --cluster devnet --profile devnet price-check
WINDOW_RPC_URL=https://api.devnet.solana.com pnpm schedule`}</Code>
          </div>
        </Card>
        <Card eyebrow="devtools" title="The whole SDK is on window.thewindow">
          <Note>
            Open DevTools on this page. The RPC client, the config, the console store and the query client are there
            too.
          </Note>
          <div className="mt-3">
            <Code>{`const { sdk, rpc } = thewindow;
await sdk.fetchAuctionConfig(rpc);
await sdk.verifyPrint(rpc, ${sampleEpoch}n);
await thewindow.schedule();                       // every listing: source, mark, both freshness verdicts, PDAs
await sdk.fetchListing(rpc, "${sampleListing?.cstockMint ?? "<a cSTOCK mint>"}");   // ${sampleListing?.symbol ?? "a listing"} by its cSTOCK mint
thewindow.console.push({ kind: "note", title: "hello from DevTools" });
thewindow.queryClient.invalidateQueries();`}</Code>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="ghost" size="sm" icon="terminal" onClick={() => devConsole.setOpen(true)}>
              open the console
            </Button>
            <a
              href="https://github.com/kaustubh76/Blinds"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-ink-2 hover:text-ink-1"
            >
              <Icon name="external" size={12} /> source
            </a>
          </div>
        </Card>
      </div>
    </div>
  );
}

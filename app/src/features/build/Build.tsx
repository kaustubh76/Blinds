/**
 * Build: the page for the developer who wants to hook in. Live recipes that run here against the
 * configured RPC (and copy as code), the programs' surface from their IDLs, the PDA seeds, the
 * app's hooks, the admin service's API, and the DevTools handle.
 */
import * as sdk from "@thewindow/solana-sdk";
import { useRef, useState } from "react";
import { Card } from "../../components/Card";
import { CopyButton } from "../../components/DevConsole";
import { Icon } from "../../components/Icon";
import { Badge, Button, ExplorerLink, Note } from "../../components/ui";
import { config } from "../../config";
import { rentFor, rpc } from "../../lib/chain";
import { devConsole, jsonSafe } from "../../lib/console";
import { useDeployment } from "../../lib/queries";
import { useSession } from "../../lib/wallet";
import { ProgramSurface } from "./ProgramSurface";
import { RECIPES, type Recipe, type RecipeCtx } from "./recipes";
import { Schedule } from "./Schedule";
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

function RecipeCard({ r }: { r: Recipe }) {
  const s = useSession();
  const dep = useDeployment();
  const [running, setRunning] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [out, setOut] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ms, setMs] = useState<number | null>(null);
  const [showCode, setShowCode] = useState(false);
  const ctrl = useRef<AbortController | null>(null);

  const ctx: RecipeCtx = {
    sdk,
    rpc,
    config,
    deployment: dep.data ?? null,
    wallet: s.address,
    memberSignature: s.memberSignature,
    rentFor,
    signal: ctrl.current?.signal ?? new AbortController().signal,
    log: (line) => setLines((l) => [...l, line]),
  };
  const blocked =
    r.needs === "wallet" && !s.address
      ? "connect a wallet or take a burner"
      : r.needs === "keys" && !s.memberSignature
        ? "derive your keys on the Desk first"
        : null;

  const run = async () => {
    const c = new AbortController();
    ctrl.current = c;
    setRunning(true);
    setLines([]);
    setOut(null);
    setErr(null);
    const t0 = performance.now();
    const id = devConsole.push({
      kind: "call",
      title: `recipe: ${r.title}`,
      code: r.code({ ...ctx, signal: c.signal }),
      state: "pending",
    });
    try {
      // The public devnet RPC answers 429 when the market, the agents and a browser share one IP; a
      // recipe is idempotent, so retry the whole run a few times before showing the error.
      let v: unknown;
      for (let attempt = 1; ; attempt++) {
        try {
          v = await r.run({ ...ctx, signal: c.signal });
          break;
        } catch (e) {
          if (attempt >= 4 || c.signal.aborted || !/429/.test(e instanceof Error ? e.message : String(e))) throw e;
          setLines((l) => [...l, `RPC answered 429 — retrying (${attempt}/3)`]);
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
      setMs(Math.round(performance.now() - t0));
      setRunning(false);
      ctrl.current = null;
    }
  };

  return (
    <li data-recipe={r.id} className="rounded-[var(--radius-lg)] border border-line bg-surface-1 p-4">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-medium text-ink-1">{r.title}</span>
        {r.needs && <Badge tone={blocked ? "warn" : "good"}>{r.needs === "wallet" ? "wallet" : "keys"}</Badge>}
        {ms !== null && !running && <span className="mono text-[11px] text-ink-3">{ms} ms</span>}
        <span className="ml-auto flex items-center gap-1">
          <Button variant="ghost" size="sm" icon="code" onClick={() => setShowCode((v) => !v)}>
            {showCode ? "hide code" : "code"}
          </Button>
          {running ? (
            <Button variant="ghost" size="sm" icon="stop" onClick={() => ctrl.current?.abort()}>
              abort
            </Button>
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
    "a listing's quote read where the program reads it — the cache PDA, or its Pyth account under source 4 — and the mint's ScaledUiAmount multiplier",
  ],
  [
    "useOnChainListings() / useSelectedListing()",
    "the schedule as the chain has it · the listing the Desk is working (persisted per browser; the token signature follows it)",
  ],
  [
    "useUnderlying(feedId)",
    "Pyth's mainnet push-oracle account read in the browser (the equity beside the wrapper) — lib/pyth.ts",
  ],
  ["useMember(owner) / useBids(wallet) / useLoans(wallet)", "membership (public), sealed bids, loans on both sides"],
  ["useTokenAccounts(wallet, mock, cstock)", "the two ATAs and the confidential-extension view"],
  ["useWindowClock()", "phase, progress, seconds left — the ring's single source of truth"],
  ["useDesk(account)", "deriveKeys · join · onboard · wrap · applyPending · bid (mutations) + decrypted balances"],
  ["usePositions(account)", "lock (priced solvency proof) · deposit (confidential transfer to escrow)"],
  ["useVerify(print)", "verifyPrint with per-stage timing → a verdict"],
  ["useConsole() / useLiveEvents()", "the developer console store · the WebSocket layer's state and last events"],
];

export function Build() {
  const dep = useDeployment();
  const admin = dep.data?.adminUrl ?? config.adminUrl ?? "";
  const adminShown = admin || "http://127.0.0.1:9090";
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
              The SDK is <span className="mono">@thewindow/solana-sdk</span> in the repo's{" "}
              <span className="mono">sdk/</span> — generated clients for the five programs (Codama), transaction plans,
              the rates math, and the proof engine compiled to wasm. It is built on{" "}
              <span className="mono">@solana/kit</span>. Not on npm yet: use it from the repo.
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
                <li key={k} className="flex items-center gap-2">
                  <span className="w-16 text-ink-3">{k}</span>
                  <ExplorerLink address={sdk.PROGRAMS[k]} cluster={config.cluster}>
                    {sdk.PROGRAMS[k]}
                  </ExplorerLink>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </Card>

      <Card
        eyebrow="the collateral schedule · live"
        title="Three listings, one rate — what the chain would accept right now"
        footer="Two rules per listing at lock_collateral and seize: the keeper must have posted within max_price_age slots, and the quote's own publish_time must be within max_publish_age. Attested marks carry the keeper's fetch time; the Pyth quote carries the publisher's."
      >
        <Schedule />
      </Card>

      <Tracks />

      <Card
        eyebrow="live recipes"
        title="Run it here, copy it as code"
        footer="Each run lands in the console (`) with the exact snippet. Secrets — the wallet signatures, bid openings — are never rendered."
      >
        <ul className="grid gap-3">
          {RECIPES.map((r) => (
            <RecipeCard key={r.id} r={r} />
          ))}
        </ul>
      </Card>

      <Card eyebrow="program surface" title="Five programs, from their IDLs">
        <ProgramSurface />
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card eyebrow="pdas" title="Seeds (sdk.pda.*)">
          <table className="w-full text-xs">
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
        </Card>
        <Card
          eyebrow="hooks"
          title="The hooks this app is built from"
          footer="Components are presentational; every chain read lives in app/src/lib/queries.ts, every write in useDesk / usePositions."
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
            The administrator runs it; the app only needs it for <span className="mono">POST /join</span>. The faucet is
            rate-limited (a wallet is funded once; a global cap per hour; refused below a balance floor).
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
await sdk.verifyPrint(rpc, 31n);
await thewindow.schedule();                       // every listing: source, mark, both freshness verdicts, PDAs
await sdk.fetchListing(rpc, "GRDt32Vp2BNEJPe1CFzSZaAFhCRw5bymWXH7tJrRZZhs");   // T-OpenAI-mock by its cSTOCK mint
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

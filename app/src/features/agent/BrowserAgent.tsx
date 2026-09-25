/**
 * Run the agent yourself.
 *
 * The desk already has six simulated members quoting every window from `services/admin/src/agents.rs`.
 * This is the same strategy under your own key, in your own tab, with every constant turned into a
 * dial — so "an agent that lends" stops being a sentence on a page and becomes something you operate.
 * The arithmetic is in `strategy.ts` and tested there; the sending is the Desk's own `useDesk`, so a
 * quote from here is indistinguishable on chain from a quote from the Desk.
 */
import type { UiWalletAccount } from "@wallet-standard/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Card } from "../../components/Card";
import { Icon } from "../../components/Icon";
import { Stat } from "../../components/Stat";
import { Badge, Button, ExplorerLink, Field, inputCls, Note, Pill } from "../../components/ui";
import { WalletButton } from "../../components/WalletButton";
import { config } from "../../config";
import { BURNER_WALLET_NAME, createBurner, hasBurner } from "../../lib/burner";
import { devConsole } from "../../lib/console";
import { formatRate, formatUsdc, parseUnits } from "../../lib/format";
import { readPrefValue, writePrefValue } from "../../lib/prefs";
import { useAuctionConfig, useEpoch, useOracle } from "../../lib/queries";
import { useWindowClock } from "../../lib/useWindowClock";
import { useSession } from "../../lib/wallet";
import { DEFAULT_WRAP_SHARES, useDesk } from "../desk/useDesk";
import {
  ASK,
  BID,
  blockedReason,
  DEFAULT_DIALS,
  type Dials,
  explain,
  MAX_TICK,
  type Quote,
  quoteFor,
  type Side,
  xorshift,
} from "./strategy";

/**
 * What the agent wraps before its first quote, if it holds nothing: the Desk's own default, scaled by
 * the listing's decimals. Not a bare literal — the faucet's grant is 10,000 shares, and a number above
 * it fails inside Token-2022 rather than anywhere a reader would look.
 */
const wrapMilli = (decimals: number) => parseUnits(String(DEFAULT_WRAP_SHARES), decimals) ?? 0n;
/** How often the loop looks at the window. A window is minutes long; this is not a hot path. */
const LOOP_MS = 2_500;

interface Done {
  at: number;
  epoch: string;
  quote: Quote;
  signature: string | null;
  error?: string;
}

const DIAL_KEYS = ["restingTick", "band", "lenderOffset", "sizeMinUsdc", "sizeSpanUsdc"] as const;
type DialKey = (typeof DIAL_KEYS)[number];

function readDials(): Dials {
  const out = { ...DEFAULT_DIALS };
  for (const k of DIAL_KEYS) {
    const n = Number(readPrefValue(`agent.${k}`, String(DEFAULT_DIALS[k])));
    if (Number.isFinite(n) && n >= 0) out[k] = n;
  }
  return out;
}

export function BrowserAgent() {
  const s = useSession();
  if (!s.account) return <NeedsAKey />;
  return <Agent account={s.account} />;
}

/**
 * No key, so nothing to sign with. The Desk's own offer, compressed: this page is not the place to
 * explain burners, but it is the place where you find out you need one.
 */
function NeedsAKey() {
  const s = useSession();
  const [error, setError] = useState<string | null>(null);
  const burner = s.wallets.find((w) => w.name === BURNER_WALLET_NAME);
  return (
    <Card
      eyebrow="run it yourself"
      title="Quote a window with the agents' own strategy"
      footer="The strategy is services/admin/src/agents.rs, ported to this tab."
    >
      <p className="text-sm leading-relaxed text-ink-2">
        Six agents quote every window. With a key of your own you can run their strategy and change its numbers.
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button
          icon="zap"
          disabled={!burner}
          onClick={() => {
            setError(null);
            (async () => {
              if (!burner) return;
              if (!hasBurner()) await createBurner();
              await s.connect(burner);
            })().catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
          }}
        >
          {hasBurner() ? "Use my devnet burner" : "Create a devnet burner"}
        </Button>
        <WalletButton />
      </div>
      {error && (
        <div className="mt-3">
          <Note tone="bad">{error}</Note>
        </div>
      )}
    </Card>
  );
}

function Agent({ account }: { account: UiWalletAccount }) {
  const d = useDesk(account);
  const clock = useWindowClock();
  const cfg = useAuctionConfig();
  const oracle = useOracle();
  const epochQ = useEpoch(cfg.data?.currentEpoch ?? null);

  const [dials, setDials] = useState<Dials>(readDials);
  const [side, setSide] = useState<Side>(ASK);
  const [seed, setSeed] = useState(() => readPrefValue("agent.seed", "42"));
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [done, setDone] = useState<Done[]>([]);
  const [error, setError] = useState<string | null>(null);

  const lastTick = oracle.data?.hasPrinted && oracle.data.lastRStarTick !== 255 ? oracle.data.lastRStarTick : null;

  // The strategy's own generator, so a seed replays. Rebuilt when the seed changes, and never during
  // a quote: a `useRef` because the loop must not re-subscribe every time it draws a number.
  const rng = useRef(xorshift(Number(seed) || 1));
  useEffect(() => {
    rng.current = xorshift(Number(seed) || 1);
  }, [seed]);

  const setDial = (k: DialKey, v: string) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < 0) return;
    writePrefValue(`agent.${k}`, v);
    setDials((prev) => ({ ...prev, [k]: n }));
  };

  // The window, as the strategy asks about it. `epochSlots` is the config's; `startSlot` the epoch's.
  const view = {
    open: !!cfg.data?.hasOpenEpoch,
    slot: clock.slot,
    startSlot: epochQ.data ? Number(epochQ.data.startSlot) : null,
    epochSlots: cfg.data ? Number(cfg.data.epochSlots) : null,
  };
  const blocked = blockedReason(view);

  // What the *next* quote would be, recomputed only from the dials — a preview must not consume a
  // draw from the generator, or reading the page would change what the agent does.
  const preview = quoteFor(side, lastTick, dials, (n) => Math.trunc(n / 2));

  // The bids already placed this session, so the same (epoch, side, tick) is never sent twice — the
  // bid PDA is keyed on exactly that, so a repeat is a guaranteed failure (agents.rs:277).
  const placed = useRef(new Set<string>());

  const quoteOnce = useCallback(
    async (why: string) => {
      const epoch = cfg.data?.currentEpoch;
      if (epoch === undefined) throw new Error("the auction config has not loaded yet");
      setBusy(why);
      try {
        if (!d.ready() || (d.balances.data ? d.balances.data.available + d.balances.data.pending : 0n) === 0n)
          await d.prepare.mutateAsync({
            wrapShares: wrapMilli(d.listing?.decimals ?? 3),
            waitForWindow: false,
            label: "agent",
          });
        const q = quoteFor(side, lastTick, dials, rng.current);
        const key = `${epoch}:${q.side}:${q.tick}`;
        if (placed.current.has(key)) {
          devConsole.push({
            kind: "note",
            title: `agent: already bid at tick ${q.tick} this window — skipping (the bid account is keyed on it)`,
          });
          return;
        }
        devConsole.push({ kind: "note", title: `agent: ${explain(q, dials, lastTick)}` });
        const sigs = await d.bid.mutateAsync({ side: q.side, tick: q.tick, sizeMicroUsdc: q.sizeMicroUsdc });
        placed.current.add(key);
        setDone((prev) => [
          { at: Date.now(), epoch: epoch.toString(), quote: q, signature: sigs[sigs.length - 1] ?? null },
          ...prev.slice(0, 19),
        ]);
      } finally {
        setBusy(null);
      }
    },
    [cfg.data?.currentEpoch, d, dials, lastTick, side],
  );

  // The loop. One timer, cleared on unmount and whenever `running` goes false, so leaving the page
  // cannot leave an agent bidding in the background.
  const latest = useRef({ blocked, epoch: clock.epoch, busy });
  latest.current = { blocked, epoch: clock.epoch, busy };
  useEffect(() => {
    if (!running) return;
    let live = true;
    let timer = 0;
    const quotedEpochs = new Set<string>();
    const tick = () => {
      timer = window.setTimeout(() => {
        if (!live) return;
        const { blocked: b, epoch, busy: working } = latest.current;
        const key = epoch?.toString() ?? "";
        if (!working && !b && key && !quotedEpochs.has(key)) {
          quotedEpochs.add(key);
          quoteOnce("this window")
            .catch((e: unknown) => {
              setError(e instanceof Error ? e.message : String(e));
              // A failure is not a reason to hammer the same window again; the next one gets a turn.
            })
            .finally(tick);
          return;
        }
        tick();
      }, LOOP_MS);
    };
    tick();
    devConsole.push({ kind: "note", title: "agent: running — one quote per window while this tab is open" });
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [running, quoteOnce]);

  const balance = d.balances.data ? d.balances.data.available + d.balances.data.pending : null;
  const cluster = config.cluster === "devnet" ? "devnet" : "custom";

  return (
    <Card
      eyebrow="run it yourself · writes to the chain"
      title="Quote a window with the agents' own strategy"
      right={
        <div className="flex flex-wrap items-center gap-2">
          {running ? (
            <Pill tone="good" icon="play">
              running
            </Pill>
          ) : (
            <Pill icon="stop">stopped</Pill>
          )}
          <Button
            size="sm"
            variant="ghost"
            icon="refresh"
            onClick={() => {
              const next = String(Math.floor(Math.random() * 1e9));
              setSeed(next);
              writePrefValue("agent.seed", next);
            }}
            title="a new seed draws a different spread and size"
          >
            reseed
          </Button>
          <Button
            size="sm"
            icon={running ? "stop" : "play"}
            variant={running ? "danger" : "primary"}
            onClick={() => setRunning((v) => !v)}
          >
            {running ? "Stop" : "Run every window"}
          </Button>
          <Button
            size="sm"
            icon="zap"
            loading={!!busy}
            disabled={running || !!blocked}
            onClick={() => {
              setError(null);
              quoteOnce("now").catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
            }}
            title={blocked ?? "seal one bid now"}
          >
            Quote now
          </Button>
        </div>
      }
      footer="Each quote is the Desk's own buildBidPlan → sendPlan · three transactions."
    >
      <div className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Stat
            label="last printed xONIA"
            value={lastTick === null ? "no print yet" : formatRate(lastTick)}
            hint={lastTick === null ? `so the anchor rests at ${dials.restingTick}` : `tick ${lastTick}`}
          />
          <Stat label="anchor" value={String(preview.anchor)} hint={`(last + resting ${dials.restingTick}) / 2`} />
          <Stat
            label="next quote"
            value={`${side === ASK ? "lend" : "borrow"} ${formatRate(preview.tick)}`}
            hint={`tick ${preview.tick} · ${blocked ? blocked : "a window is open"}`}
          />
          <Stat
            label="your cSTOCK-W"
            value={balance === null ? "—" : balance.toString()}
            hint={balance === null ? "set up on the first quote" : "milli-shares, sealed on chain"}
          />
        </div>

        <div className="grid gap-3 rounded-[var(--radius-md)] border border-line bg-surface-2 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="mono text-[11px] uppercase tracking-[0.14em] text-ink-3">the dials</div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                variant={side === ASK ? "primary" : "ghost"}
                onClick={() => setSide(ASK)}
                title="quote as a lender: under the anchor"
              >
                lend
              </Button>
              <Button
                size="sm"
                variant={side === BID ? "primary" : "ghost"}
                onClick={() => setSide(BID)}
                title="quote as a borrower: over the anchor"
              >
                borrow
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  for (const k of DIAL_KEYS) writePrefValue(`agent.${k}`, String(DEFAULT_DIALS[k]));
                  setDials({ ...DEFAULT_DIALS });
                }}
              >
                the Rust defaults
              </Button>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Field label="resting tick" hint={`${formatRate(Math.min(MAX_TICK, dials.restingTick))} · agents.rs:77`}>
              <input
                className={inputCls}
                type="number"
                min={0}
                max={MAX_TICK}
                value={dials.restingTick}
                onChange={(e) => setDial("restingTick", e.target.value)}
                aria-label="resting tick"
              />
            </Field>
            <Field label="spread" hint="rand(n) ticks added">
              <input
                className={inputCls}
                type="number"
                min={1}
                max={12}
                value={dials.band}
                onChange={(e) => setDial("band", e.target.value)}
                aria-label="spread"
              />
            </Field>
            <Field label="lender offset" hint="ticks under the anchor">
              <input
                className={inputCls}
                type="number"
                min={0}
                max={12}
                value={dials.lenderOffset}
                onChange={(e) => setDial("lenderOffset", e.target.value)}
                aria-label="lender offset"
              />
            </Field>
            <Field label="size floor" hint="USDC">
              <input
                className={inputCls}
                type="number"
                min={1}
                value={dials.sizeMinUsdc}
                onChange={(e) => setDial("sizeMinUsdc", e.target.value)}
                aria-label="size floor"
              />
            </Field>
            <Field
              label="size span"
              hint={`up to ${formatUsdc(BigInt(dials.sizeMinUsdc + dials.sizeSpanUsdc) * 1_000_000n)}`}
            >
              <input
                className={inputCls}
                type="number"
                min={1}
                value={dials.sizeSpanUsdc}
                onChange={(e) => setDial("sizeSpanUsdc", e.target.value)}
                aria-label="size span"
              />
            </Field>
          </div>
          <Note>
            {explain(preview, dials, lastTick)}. The spread and the size are drawn from seed {seed}.
          </Note>
        </div>

        {error && <Note tone="bad">{error}</Note>}
        {busy && <Note>working: {busy}…</Note>}

        <div>
          <div className="mono mb-2 text-[11px] uppercase tracking-[0.14em] text-ink-3">
            what this agent has done in this tab
          </div>
          {done.length === 0 ? (
            <Note>Nothing yet. A quote takes three transactions and about fifteen seconds.</Note>
          ) : (
            <ul className="grid gap-1.5">
              {done.map((r) => (
                <li
                  key={`${r.epoch}-${r.quote.side}-${r.quote.tick}-${r.at}`}
                  className="flex flex-wrap items-center gap-2 rounded-[var(--radius-sm)] border border-line px-3 py-2 text-xs"
                >
                  <Badge tone={r.quote.side === ASK ? "lend" : "borrow"}>
                    {r.quote.side === ASK ? "lend" : "borrow"}
                  </Badge>
                  <span className="mono text-ink-2">epoch {r.epoch}</span>
                  <span className="text-ink-1">{formatRate(r.quote.tick)}</span>
                  <span className="mono text-ink-3">tick {r.quote.tick}</span>
                  <span className="text-ink-2">{formatUsdc(r.quote.sizeMicroUsdc)}</span>
                  {r.signature && <ExplorerLink address={r.signature} cluster={cluster} kind="tx" />}
                </li>
              ))}
            </ul>
          )}
        </div>

        <Note>
          <Icon name="clock" size={11} className="mr-1 inline" />
          Unlike the six: this one stops at the bid, and stops when you close the tab.
        </Note>
      </div>
    </Card>
  );
}

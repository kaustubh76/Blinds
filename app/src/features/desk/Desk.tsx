/**
 * Borrow / lend desk: five steps — keys → membership → confidential account → wrap → bid — with a
 * progress rail on the left and one step at a time on the right. Every quantity typed here is
 * encrypted in this browser before it touches a transaction; the administrator (auditor key) can
 * read it, other members cannot. All logic lives in `useDesk`; this file is presentation.
 */
import { TICKS } from "@thewindow/solana-sdk";
import type { UiWalletAccount } from "@wallet-standard/react";
import { useEffect, useMemo, useState } from "react";
import { Card } from "../../components/Card";
import { EncryptedValue } from "../../components/EncryptedValue";
import { Icon } from "../../components/Icon";
import { ListingCard } from "../../components/ListingCard";
import { ProgressRail, type RailState } from "../../components/ProgressRail";
import { TxTimeline } from "../../components/TxTimeline";
import { Badge, Button, Callout, ExplorerLink, Field, inputCls, Note, Pill } from "../../components/ui";
import { WalletButton } from "../../components/WalletButton";
import { WindowClock } from "../../components/WindowClock";
import { config } from "../../config";
import { BURNER_WALLET_NAME, createBurner, hasBurner } from "../../lib/burner";
import { describeError } from "../../lib/chain";
import { formatRate, formatShares, formatUsdc, parseUnits } from "../../lib/format";
import { useDeployment, useOracle, usePrices, useSlot } from "../../lib/queries";
import { useWindowClock } from "../../lib/useWindowClock";
import { useSession } from "../../lib/wallet";
import { DESK_PREFILL_KEY } from "../home/Home";
import { useDesk } from "./useDesk";

export function Desk() {
  const s = useSession();
  const [burnerError, setBurnerError] = useState<string | null>(null);
  if (!s.account) {
    const burner = s.wallets.find((w) => w.name === BURNER_WALLET_NAME);
    return (
      <div className="mx-auto grid max-w-[720px] gap-6 py-6">
        <div className="text-center">
          <div className="t-eyebrow">the desk</div>
          <h1 className="t-h1 mt-2 text-ink-1">Borrow or lend against tokenized stock</h1>
          <p className="t-lead mx-auto mt-3 max-w-[48ch]">
            Five steps, every one of them a transaction you can read in the console. Take a devnet burner and there are
            no prompts at all.
          </p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <button
            type="button"
            disabled={!burner}
            onClick={() => {
              setBurnerError(null);
              (async () => {
                if (!burner) return;
                if (!hasBurner()) await createBurner();
                await s.connect(burner);
              })().catch((e: unknown) => setBurnerError(e instanceof Error ? e.message : String(e)));
            }}
            className="brand-wash grid gap-2 rounded-[var(--radius-xl)] border border-accent/30 bg-surface-1 p-6 text-left transition-colors hover:border-accent disabled:opacity-60"
          >
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-accent text-accent-ink">
              <Icon name="zap" size={20} />
            </span>
            <span className="text-lg font-semibold text-ink-1">
              {hasBurner() ? "Use my devnet burner" : "Create a devnet burner"}
            </span>
            <span className="text-sm text-ink-2">
              A throwaway key kept in this browser. The faucet funds it; every step runs with no prompts.
            </span>
          </button>
          <div className="grid gap-2 rounded-[var(--radius-xl)] border border-line bg-surface-1 p-6">
            <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface-2 text-ink-1">
              <Icon name="wallet" size={20} />
            </span>
            <span className="text-lg font-semibold text-ink-1">Connect a wallet</span>
            <span className="text-sm text-ink-2">
              Any wallet-standard wallet on devnet. Two signatures derive your keys; they never leave this tab.
            </span>
            <span className="mt-1">
              <WalletButton />
            </span>
          </div>
        </div>
        {burnerError && <Note tone="bad">{burnerError}</Note>}
        <Callout icon="eyeOff" title="What the desk never learns from your browser">
          Your ElGamal keys. They are derived from wallet signatures in this tab and used to encrypt your bid size and
          collateral before anything is sent.
        </Callout>
      </div>
    );
  }
  return <DeskFlow account={s.account} />;
}

function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function readPrefill(): { key: string; usdc: number } | null {
  try {
    const raw = sessionStorage.getItem(DESK_PREFILL_KEY);
    return raw ? (JSON.parse(raw) as { key: string; usdc: number }) : null;
  } catch {
    return null;
  }
}

function DeskFlow({ account }: { account: UiWalletAccount }) {
  const s = useSession();
  const d = useDesk(account);
  const dep = useDeployment();
  const slot = useSlot();
  const oracle = useOracle();
  const clock = useWindowClock();
  const prices = usePrices(dep.data?.listings.map((l) => l.feedId));
  const prefill = useMemo(readPrefill, []);
  const [wrapAmount, setWrapAmount] = useState("1000");
  const [side, setSide] = useState<0 | 1>(1);
  const lastTick = oracle.data?.hasPrinted && oracle.data.lastRStarTick !== 255 ? oracle.data.lastRStarTick : null;
  const [tick, setTick] = useState(lastTick ?? 8);
  const [size, setSize] = useState(prefill?.usdc ? String(prefill.usdc) : "1000");
  const [picked, setPicked] = useState<number | null>(null);
  const cluster = config.cluster;
  const keysReady = !!d.memberKey.data && !!s.tokenSignature;
  const isMember = !!d.member.data;
  const configured = !!d.accounts.data?.cstock.configured;
  const decimals = d.listing?.decimals ?? d.dep.data?.decimals ?? 3;
  const faucet = !!d.dep.data?.faucet;
  const busy =
    d.deriveKeys.isPending ||
    d.join.isPending ||
    d.onboard.isPending ||
    d.wrap.isPending ||
    d.bid.isPending ||
    d.autopilot.isPending;
  const err = [d.deriveKeys, d.join, d.onboard, d.wrap, d.applyPending, d.bid, d.autopilot].find((m) => m.error)?.error;
  const isBurner = s.wallet?.name === BURNER_WALLET_NAME;
  const keyMatches =
    d.memberKey.data && d.member.data ? sameBytes(d.memberKey.data, d.member.data.elgamalPubkey) : null;
  const balances = d.balances.data;
  const v = d.accounts.data?.cstock.view;
  const wrapped = !!balances && balances.available + balances.pending > 0n;
  const windowOpen = !!d.cfg.data?.hasOpenEpoch;

  const states: RailState[] = [
    keysReady ? "done" : "active",
    isMember ? "done" : !keysReady ? "todo" : !faucet ? "blocked" : "active",
    configured ? "done" : !isMember ? "todo" : "active",
    !configured ? "todo" : wrapped ? "done" : "active",
    !isMember || !keysReady ? "todo" : !windowOpen ? "blocked" : "active",
  ];
  const firstOpen = states.findIndex((x) => x === "active" || x === "blocked");
  // A step you clicked stays until it completes; then the rail moves on by itself.
  const pickedDone = picked !== null && states[picked] === "done";
  useEffect(() => {
    if (pickedDone) setPicked(null);
  }, [pickedDone]);
  const current = picked !== null && !pickedDone ? picked : firstOpen === -1 ? 4 : firstOpen;

  const rail = [
    { title: "Derive your keys", state: states[0] as RailState, hint: keysReady ? "in this tab" : "two signatures" },
    {
      title: "Join the desk",
      state: states[1] as RailState,
      hint: isMember
        ? `member since epoch ${d.member.data?.joinedEpoch.toString()}`
        : faucet
          ? "via the faucet"
          : "faucet offline",
    },
    {
      title: "Confidential account",
      state: states[2] as RailState,
      hint: d.listing?.symbol.replace(/-mock$/, "") ?? "",
    },
    {
      title: "Wrap collateral",
      state: states[3] as RailState,
      hint: balances ? `${formatShares(balances.available, decimals)} available` : "",
    },
    {
      title: "Seal a bid",
      state: states[4] as RailState,
      hint: windowOpen ? `epoch ${d.cfg.data?.currentEpoch.toString()} open` : "between windows",
    },
  ];

  const sel = d.listing;
  const selIndex = d.listings.findIndex((l) => l.key === sel?.key);

  return (
    <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
      {/* Rail */}
      <aside className="grid content-start gap-4">
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface-1 p-3">
          <div className="t-eyebrow px-2 pb-2 pt-1">your progress</div>
          <ProgressRail steps={rail} onPick={setPicked} />
        </div>
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface-1 p-4">
          <div className="flex items-center justify-between">
            <div className="t-eyebrow">collateral</div>
            {d.listings.length > 1 && <span className="text-[11px] text-ink-3">{d.listings.length} listed</span>}
          </div>
          <div className="mt-2 grid gap-2">
            {d.listings.map((l, i) => (
              <ListingCard
                key={l.key}
                listing={l}
                price={prices.data?.[i]}
                slot={slot.data}
                selected={sel?.key === l.key}
                compact
                onSelect={d.selectListing}
              />
            ))}
          </div>
        </div>
        <div className="rounded-[var(--radius-lg)] border border-line bg-surface-1 p-4 text-sm">
          <div className="t-eyebrow">wallet</div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <ExplorerLink address={d.wallet} cluster={cluster} />
            {isBurner && <Pill tone="mute">burner</Pill>}
          </div>
          {d.accounts.data && (
            <div className="mt-2 text-xs text-ink-3">
              {d.accounts.data.mockAmount === null
                ? "no public shares yet"
                : `${formatShares(d.accounts.data.mockAmount, decimals)} public · ${
                    balances ? formatShares(balances.available, decimals) : "—"
                  } confidential`}
            </div>
          )}
        </div>
      </aside>

      {/* Step */}
      <div className="grid content-start gap-4">
        {d.dep.data && !faucet && (
          <Callout icon="alert" tone="warn" title="The demo faucet is not reachable from this browser">
            Joining and minting are unavailable; reading the chain and bidding (if this wallet is already a member)
            still work. Open the page from the link the market prints, or set the admin URL in Settings.
          </Callout>
        )}

        {current === 0 && (
          <StepCard n={1} title="Derive your keys" state={states[0] as RailState}>
            <p className="text-sm leading-relaxed text-ink-2">
              Two wallet signatures — one for the member key your bids are encrypted to, one for your confidential
              account on <b className="text-ink-1">{sel?.symbol.replace(/-mock$/, "")}</b>. They stay in this tab; the
              keys never leave your browser.
            </p>
            {d.memberKey.data && (
              <div className="mt-3">
                <EncryptedValue bytes={d.memberKey.data} label="member key" />
              </div>
            )}
            <div className="mt-5">
              <Button
                size="lg"
                onClick={() => d.deriveKeys.mutate()}
                loading={d.deriveKeys.isPending}
                disabled={busy || !d.accounts.data}
                icon="key"
                variant={keysReady ? "ghost" : "primary"}
              >
                {keysReady
                  ? "Re-derive"
                  : s.memberSignature
                    ? `Sign for ${sel?.symbol ?? "this listing"}`
                    : "Sign twice to derive"}
              </Button>
            </div>
          </StepCard>
        )}

        {current === 1 && (
          <StepCard n={2} title="Join the desk" state={states[1] as RailState}>
            {isMember ? (
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone="good" icon="check">
                  member since epoch {d.member.data?.joinedEpoch.toString()}
                </Badge>
                {keyMatches !== null && (
                  <Badge tone={keyMatches ? "good" : "bad"} icon={keyMatches ? "check" : "alert"}>
                    {keyMatches ? "registry holds this key" : "registry holds a different key"}
                  </Badge>
                )}
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-ink-2">
                The administrator registers your wallet and member key, mints you 10,000 shares of every listed
                collateral and sends 0.1 SOL for fees. Membership is a public fact; your positions are not.
              </p>
            )}
            <div className="mt-5">
              <Button
                size="lg"
                onClick={() => d.join.mutate()}
                loading={d.join.isPending}
                disabled={busy || !keysReady || !faucet || isMember}
                icon="arrowRight"
              >
                {isMember ? "Joined" : "Join"}
              </Button>
            </div>
          </StepCard>
        )}

        {current === 2 && (
          <StepCard n={3} title="Set up your confidential account" state={states[2] as RailState}>
            <p className="text-sm leading-relaxed text-ink-2">
              One account per collateral. Creating it takes two transactions: create, then configure it with a proof
              that your ElGamal key is well formed. Pick a different collateral on the left at any time.
            </p>
            {d.accounts.data && (
              <dl className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                <div className="rounded-[var(--radius-md)] bg-surface-2 p-3">
                  <dt className="t-eyebrow">{sel?.symbol.replace(/-mock$/, "")} · public</dt>
                  <dd className="mt-1 text-ink-1">
                    {d.accounts.data.mockAmount === null
                      ? "not created yet"
                      : `${formatShares(d.accounts.data.mockAmount, decimals)} shares`}
                  </dd>
                  <dd className="mt-1">
                    <ExplorerLink address={d.accounts.data.mockAta} cluster={cluster} />
                  </dd>
                </div>
                <div className="rounded-[var(--radius-md)] bg-surface-2 p-3">
                  <dt className="t-eyebrow">cSTOCK-W · confidential</dt>
                  <dd className="mt-1 text-ink-1">{configured ? "configured" : "not configured yet"}</dd>
                  <dd className="mt-1">
                    <ExplorerLink address={d.accounts.data.cstockAta} cluster={cluster} />
                  </dd>
                </div>
              </dl>
            )}
            <div className="mt-5">
              <Button
                size="lg"
                onClick={() => d.onboard.mutate()}
                loading={d.onboard.isPending}
                disabled={busy || !isMember || !keysReady || configured}
                icon="shield"
              >
                {configured ? "Configured" : "Create + configure"}
              </Button>
            </div>
          </StepCard>
        )}

        {current === 3 && (
          <StepCard n={4} title="Wrap shares into confidential collateral" state={states[3] as RailState}>
            <p className="text-sm leading-relaxed text-ink-2">
              Moves public shares into custody and credits your confidential balance 1:1. The wrap leg is a public
              transfer, so wrap a round amount once, ahead of bidding.
            </p>
            {configured && v && (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <Vault
                  label="available"
                  bytes={v.availableBalance}
                  plain={balances ? formatShares(balances.available, decimals) : null}
                />
                <Vault
                  label="pending"
                  bytes={v.pendingBalanceLo}
                  plain={balances ? formatShares(balances.pending, decimals) : null}
                >
                  {balances && balances.pending > 0n && (
                    <Button
                      size="sm"
                      variant="soft"
                      onClick={() => d.applyPending.mutate()}
                      loading={d.applyPending.isPending}
                      disabled={busy}
                    >
                      Apply pending
                    </Button>
                  )}
                </Vault>
              </div>
            )}
            <div className="mt-5 flex flex-wrap items-end gap-3">
              <Field label="shares to wrap">
                <input
                  className={`${inputCls} w-40`}
                  value={wrapAmount}
                  onChange={(e) => setWrapAmount(e.target.value)}
                />
              </Field>
              <Button
                size="lg"
                onClick={() => {
                  const amt = parseUnits(wrapAmount, decimals);
                  if (amt && amt > 0n) d.wrap.mutate(amt);
                }}
                loading={d.wrap.isPending}
                disabled={busy || !balances || !configured}
                icon="lock"
              >
                Wrap
              </Button>
            </div>
          </StepCard>
        )}

        {current === 4 && (
          <StepCard n={5} title="Seal a bid" state={states[4] as RailState}>
            {!windowOpen && isMember && keysReady ? (
              <div className="flex flex-wrap items-center gap-4">
                <WindowClock clock={clock} size={96} detail={false} />
                <div className="text-sm text-ink-2">
                  <div className="font-medium text-ink-1">No window is open right now.</div>
                  The keeper opens the next one shortly; the autopilot below waits for it.
                </div>
              </div>
            ) : (
              <p className="text-sm leading-relaxed text-ink-2">
                {windowOpen
                  ? `Epoch ${d.cfg.data?.currentEpoch.toString()} is open · minimum ${formatUsdc(d.cfg.data?.sMin ?? 0n)} · one bid per side and rate. `
                  : ""}
                The size is encrypted to your key and the auditor key and proven in range; only the ciphertext goes on
                chain.
              </p>
            )}
            <div className="mt-4 grid gap-4">
              <div className="flex gap-2">
                {(
                  [
                    [1, "Borrow USDC", "borrow"],
                    [0, "Lend USDC", "lend"],
                  ] as const
                ).map(([val, label, tone]) => (
                  <button
                    key={val}
                    type="button"
                    onClick={() => setSide(val)}
                    aria-pressed={side === val}
                    className={`flex-1 rounded-[var(--radius-md)] border px-4 py-3 text-left text-sm font-medium transition-colors ${
                      side === val
                        ? tone === "borrow"
                          ? "border-borrow bg-borrow/10 text-ink-1"
                          : "border-lend bg-lend/10 text-ink-1"
                        : "border-line text-ink-2 hover:border-line-strong"
                    }`}
                  >
                    {label}
                    <span className="block text-xs font-normal text-ink-3">
                      {tone === "borrow"
                        ? "a bid: the rate you will pay at most"
                        : "an ask: the rate you want at least"}
                    </span>
                  </button>
                ))}
              </div>
              <div>
                <div className="flex items-baseline justify-between">
                  <span className="t-eyebrow">rate</span>
                  <span className="num text-lg font-semibold text-ink-1">{formatRate(tick)}</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={TICKS - 1}
                  value={tick}
                  onChange={(e) => setTick(Number(e.target.value))}
                  className="mt-2 w-full accent-[var(--color-accent)]"
                  aria-label="rate tick"
                />
                <div className="mt-1 flex justify-between text-[11px] text-ink-3">
                  <span>{formatRate(0)}</span>
                  {lastTick !== null && (
                    <button type="button" className="text-accent hover:underline" onClick={() => setTick(lastTick)}>
                      last print {formatRate(lastTick)}
                    </button>
                  )}
                  <span>{formatRate(TICKS - 1)}</span>
                </div>
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <Field label="size (USDC)">
                  <input className={`${inputCls} w-44`} value={size} onChange={(e) => setSize(e.target.value)} />
                </Field>
                <Button
                  size="lg"
                  variant="hero"
                  onClick={() => {
                    const sz = parseUnits(size, 6);
                    if (sz && sz > 0n) d.bid.mutate({ side, tick, sizeMicroUsdc: sz });
                  }}
                  loading={d.bid.isPending}
                  disabled={busy || !isMember || !keysReady || !windowOpen}
                  icon="lock"
                >
                  {d.bid.isPending ? "proving…" : "Seal and submit"}
                </Button>
              </div>
            </div>
          </StepCard>
        )}

        {/* Autopilot */}
        <Card
          tone="brand"
          eyebrow="autopilot"
          title={isBurner ? "Or run the whole desk in one click" : "Or run the whole desk"}
          right={
            <Button
              icon="play"
              variant="hero"
              onClick={() =>
                d.autopilot.mutate({
                  wrapShares: parseUnits("1000", decimals) ?? 0n,
                  sizeMicroUsdc: prefill?.usdc ? BigInt(Math.round(prefill.usdc * 1_000_000)) : 1_000_000_000n,
                  side: 1,
                })
              }
              loading={d.autopilot.isPending}
              disabled={busy || (!faucet && !isMember) || !d.accounts.data}
            >
              {d.autopilot.isPending ? "running…" : "Run it"}
            </Button>
          }
        >
          <p className="text-sm leading-relaxed text-ink-2">
            Derive → join → set up → wrap 1,000 shares → seal a{" "}
            {prefill?.usdc ? prefill.usdc.toLocaleString("en-US") : "1,000"} USDC borrow bid at the last clearing rate.
            Every step is skipped if already done; every transaction lands in the console (`).{" "}
            {isBurner ? "The burner signs silently." : "An extension wallet asks for each signature in turn."}
          </p>
        </Card>

        {(d.steps.steps.length > 0 || err) && (
          <Card eyebrow="transactions" title="This session">
            <TxTimeline steps={d.steps.steps} cluster={cluster} />
            {err && <Note tone="bad">{describeError(err)}</Note>}
          </Card>
        )}
        {selIndex >= 0 && d.listings.length > 1 && (
          <p className="text-xs text-ink-3">
            Bids are not tied to a collateral; the listing you pick matters when you lock a matched loan on Positions.
          </p>
        )}
      </div>
    </div>
  );
}

function StepCard({
  n,
  title,
  state,
  children,
}: {
  n: number;
  title: string;
  state: RailState;
  children: React.ReactNode;
}) {
  const pill =
    state === "done" ? (
      <Pill tone="good" icon="check">
        done
      </Pill>
    ) : state === "blocked" ? (
      <Pill tone="warn" icon="clock">
        waiting
      </Pill>
    ) : state === "active" ? (
      <Pill tone="accent">up next</Pill>
    ) : (
      <Pill tone="mute">later</Pill>
    );
  return (
    <section className="animate-rise rounded-[var(--radius-xl)] border border-line bg-surface-1 p-6">
      <div className="flex items-center justify-between gap-3">
        <div className="t-eyebrow">step {n} of 5</div>
        {pill}
      </div>
      <h2 className="t-h2 mt-1 text-ink-1">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Vault({
  label,
  bytes,
  plain,
  children,
}: {
  label: string;
  bytes: ArrayLike<number>;
  plain: string | null;
  children?: React.ReactNode;
}) {
  return (
    <div className="rounded-[var(--radius-lg)] border border-line bg-surface-2 p-4">
      <div className="flex items-center justify-between">
        <span className="t-eyebrow">{label}</span>
        <span className="text-accent">
          <Icon name="lock" size={14} />
        </span>
      </div>
      <div className="num mt-1 text-2xl font-semibold text-ink-1">{plain ?? "—"}</div>
      <div className="mt-2">
        <EncryptedValue bytes={bytes} label="on chain" />
      </div>
      {children && <div className="mt-2">{children}</div>}
    </div>
  );
}

/**
 * Borrow / lend desk as five steps: keys → membership → confidential account → wrap → bid.
 * Every quantity typed here is encrypted in this browser before it touches a transaction; the
 * administrator (auditor key) can read it, other members cannot.
 */
import { TICKS } from "@thewindow/solana-sdk";
import type { UiWalletAccount } from "@wallet-standard/react";
import { useState } from "react";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { EncryptedValue } from "../../components/EncryptedValue";
import { ListingPicker } from "../../components/ListingPicker";
import { type Step, Stepper } from "../../components/Stepper";
import { TxTimeline } from "../../components/TxTimeline";
import { Badge, Button, ExplorerLink, Field, inputCls, Note } from "../../components/ui";
import { WalletButton } from "../../components/WalletButton";
import { config } from "../../config";
import { BURNER_WALLET_NAME, createBurner, hasBurner } from "../../lib/burner";
import { describeError } from "../../lib/chain";
import { formatRate, formatShares, formatUsdc, parseUnits } from "../../lib/format";
import { useSession } from "../../lib/wallet";
import { useDesk } from "./useDesk";

export function Desk() {
  const s = useSession();
  const [burnerError, setBurnerError] = useState<string | null>(null);
  if (!s.account) {
    const burner = s.wallets.find((w) => w.name === BURNER_WALLET_NAME);
    return (
      <Card eyebrow="desk" title="Borrow or lend against tokenized stock">
        <EmptyState
          icon="wallet"
          title="Connect a wallet — or take a devnet burner and start now."
          action={
            <span className="flex flex-wrap items-center gap-2">
              {burner && (
                <Button
                  icon="key"
                  onClick={() => {
                    setBurnerError(null);
                    (async () => {
                      if (!hasBurner()) await createBurner();
                      await s.connect(burner);
                    })().catch((e: unknown) => setBurnerError(e instanceof Error ? e.message : String(e)));
                  }}
                >
                  {hasBurner() ? "Use my devnet burner" : "Create a devnet burner"}
                </Button>
              )}
              <WalletButton />
            </span>
          }
        >
          Two signatures derive your ElGamal keys; they stay in this tab. A burner is a throwaway key kept in this
          browser, so every step below runs with no prompts. Nothing is sent anywhere but the chain and the faucet.
          {burnerError && <span className="mt-2 block text-status-critical">{burnerError}</span>}
        </EmptyState>
      </Card>
    );
  }
  return <DeskFlow account={s.account} />;
}

function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

function DeskFlow({ account }: { account: UiWalletAccount }) {
  const s = useSession();
  const d = useDesk(account);
  const [wrapAmount, setWrapAmount] = useState("1000");
  const [side, setSide] = useState<0 | 1>(1);
  const [tick, setTick] = useState(8);
  const [size, setSize] = useState("1000");
  const cluster = config.cluster;
  // The member key is one per wallet; the token-account signature is one per listing mint.
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

  const steps: Step[] = [
    {
      title: "Derive your keys",
      state: keysReady ? "done" : "active",
      detail: (
        <>
          Two wallet signatures — one for the member key your bids are encrypted to, one for your confidential token
          account. The signatures stay in this tab's memory; the keys never leave your browser.
          {d.memberKey.data && (
            <span className="mt-2 block">
              <EncryptedValue bytes={d.memberKey.data} label="member key" />
            </span>
          )}
        </>
      ),
      action: (
        <Button
          onClick={() => d.deriveKeys.mutate()}
          loading={d.deriveKeys.isPending}
          disabled={busy || !d.accounts.data}
          icon="key"
          variant={keysReady ? "ghost" : "primary"}
        >
          {keysReady
            ? "Re-derive"
            : s.memberSignature
              ? `Sign for ${d.listing?.symbol ?? "this listing"}`
              : "Sign twice to derive"}
        </Button>
      ),
    },
    {
      title: "Join the desk",
      state: isMember ? "done" : !keysReady ? "todo" : !faucet ? "blocked" : "active",
      detail: isMember ? (
        <span className="flex flex-wrap items-center gap-2">
          <Badge tone="good" icon="check">
            member since epoch {d.member.data?.joinedEpoch.toString()}
          </Badge>
          {keyMatches !== null && (
            <Badge tone={keyMatches ? "good" : "bad"} icon={keyMatches ? "check" : "alert"}>
              {keyMatches ? "registry holds this key" : "registry holds a different key"}
            </Badge>
          )}
        </span>
      ) : !faucet && keysReady ? (
        "the demo faucet (admin service) is not reachable from this browser"
      ) : (
        "The administrator registers your wallet and member key, mints you 10,000 mock shares and sends 0.1 SOL for fees. Membership is a public fact; your positions are not."
      ),
      action: (
        <Button
          onClick={() => d.join.mutate()}
          loading={d.join.isPending}
          disabled={busy || !keysReady || !faucet}
          icon="arrowRight"
        >
          Join
        </Button>
      ),
    },
    {
      title: "Set up your confidential account",
      state: configured ? "done" : !isMember ? "todo" : "active",
      detail: d.accounts.data ? (
        <span className="grid gap-2">
          <ListingPicker listings={d.listings} selected={d.listing} onSelect={d.selectListing} disabled={busy} />
          <span>
            {d.listing?.symbol ?? "mock xStock"} <ExplorerLink address={d.accounts.data.mockAta} cluster={cluster} /> ·{" "}
            {d.accounts.data.mockAmount === null
              ? "not created yet"
              : `${formatShares(d.accounts.data.mockAmount, decimals)} shares, public balance`}
          </span>
          <span>
            cSTOCK-W <ExplorerLink address={d.accounts.data.cstockAta} cluster={cluster} /> ·{" "}
            {configured
              ? "confidential extension configured"
              : "two transactions: create + configure with a pubkey-validity proof"}
          </span>
        </span>
      ) : (
        "loading your token accounts…"
      ),
      action: !configured ? (
        <Button
          onClick={() => d.onboard.mutate()}
          loading={d.onboard.isPending}
          disabled={busy || !isMember || !keysReady}
          icon="shield"
        >
          Create + configure
        </Button>
      ) : undefined,
    },
    {
      title: "Wrap shares into cSTOCK-W",
      state: !configured ? "todo" : balances && balances.available + balances.pending > 0n ? "done" : "active",
      detail: (
        <>
          Moves mock shares into custody and credits your confidential balance. The wrap leg is a public token transfer
          (Token-2022 deposits from a public balance), so wrap a round amount once, ahead of bidding.
          {configured && v && (
            <span className="mt-2 flex flex-wrap items-center gap-3">
              <EncryptedValue
                bytes={v.availableBalance}
                label="available"
                plaintext={balances ? formatShares(balances.available, decimals) : null}
              />
              <EncryptedValue
                bytes={v.pendingBalanceLo}
                label="pending"
                plaintext={balances ? formatShares(balances.pending, decimals) : null}
              />
              {balances && balances.pending > 0n && (
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => d.applyPending.mutate()}
                  loading={d.applyPending.isPending}
                  disabled={busy}
                >
                  Apply pending
                </Button>
              )}
            </span>
          )}
        </>
      ),
      action: configured ? (
        <span className="flex items-end gap-2">
          <Field label="shares">
            <input className={`${inputCls} w-36`} value={wrapAmount} onChange={(e) => setWrapAmount(e.target.value)} />
          </Field>
          <Button
            onClick={() => {
              const amt = parseUnits(wrapAmount, decimals);
              if (amt && amt > 0n) d.wrap.mutate(amt);
            }}
            loading={d.wrap.isPending}
            disabled={busy || !balances}
          >
            Wrap
          </Button>
        </span>
      ) : undefined,
    },
    {
      title: "Submit an encrypted bid",
      state: !isMember || !keysReady ? "todo" : !d.cfg.data?.hasOpenEpoch ? "blocked" : "active",
      detail:
        !d.cfg.data?.hasOpenEpoch && isMember && keysReady ? (
          "no window is open right now — the keeper opens the next one"
        ) : (
          <>
            {d.cfg.data?.hasOpenEpoch
              ? `Epoch ${d.cfg.data.currentEpoch.toString()} is open · minimum ${formatUsdc(d.cfg.data.sMin)} · one bid per (side, rate). `
              : ""}
            The size is encrypted to your key and the auditor key and proven in range; only the ciphertext goes on
            chain. The administrator can read it with the auditor key; other members cannot.
          </>
        ),
      action: (
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Field label="side">
            <select className={inputCls} value={side} onChange={(e) => setSide(Number(e.target.value) as 0 | 1)}>
              <option value={1}>Borrow USDC (bid)</option>
              <option value={0}>Lend USDC (ask)</option>
            </select>
          </Field>
          <Field label="rate">
            <select className={inputCls} value={tick} onChange={(e) => setTick(Number(e.target.value))}>
              {Array.from({ length: TICKS }, (_, t) => (
                <option key={formatRate(t)} value={t}>
                  {formatRate(t)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="size (USDC)">
            <input className={inputCls} value={size} onChange={(e) => setSize(e.target.value)} />
          </Field>
          <div className="flex items-end">
            <Button
              onClick={() => {
                const s = parseUnits(size, 6);
                if (s && s > 0n) d.bid.mutate({ side, tick, sizeMicroUsdc: s });
              }}
              loading={d.bid.isPending}
              disabled={busy || !isMember || !keysReady || !d.cfg.data?.hasOpenEpoch}
              icon="lock"
            >
              {d.bid.isPending ? "proving…" : "Seal and submit"}
            </Button>
          </div>
        </div>
      ),
    },
  ];

  return (
    <div className="grid gap-4">
      {d.dep.data && !faucet && (
        <Note tone="warn">
          The demo faucet is not reachable from this browser, so joining and minting mock shares are unavailable.
          Everything that only reads the chain still works, and so does bidding if this wallet is already a member.
        </Note>
      )}
      <Card
        eyebrow="autopilot"
        title={isBurner ? "Run the whole desk in one click" : "Run the whole desk"}
        right={
          <Button
            icon="play"
            onClick={() =>
              d.autopilot.mutate({
                wrapShares: parseUnits("1000", decimals) ?? 0n,
                sizeMicroUsdc: 1_000_000_000n,
                side: 1,
              })
            }
            loading={d.autopilot.isPending}
            disabled={busy || (!faucet && !isMember) || !d.accounts.data}
          >
            {d.autopilot.isPending ? "running…" : "derive → join → set up → wrap → bid"}
          </Button>
        }
      >
        <Note>
          Derives keys, joins through the faucet, creates the confidential account, wraps 1,000 shares and seals a 1,000
          USDC borrow bid at the last clearing rate — every step skipped if already done, every transaction in the
          console (`).{" "}
          {isBurner ? "The burner signs silently." : "An extension wallet asks for each signature in turn."}
          {!faucet &&
            " Needs the faucet: open this page from the link the market prints, or set the admin URL in Settings."}
        </Note>
      </Card>
      <Stepper steps={steps} />
      {(d.steps.steps.length > 0 || err) && (
        <Card eyebrow="transactions" title="This session">
          <TxTimeline steps={d.steps.steps} cluster={cluster} />
          {err && <Note tone="bad">{describeError(err)}</Note>}
        </Card>
      )}
    </div>
  );
}

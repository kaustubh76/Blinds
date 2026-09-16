/**
 * Borrow / lend desk: connect → derive keys → join → confidential account → wrap → bid.
 * Every quantity typed here is encrypted in this browser before it touches a transaction.
 */
import { TICKS } from "@thewindow/solana-sdk";
import type { UiWalletAccount } from "@wallet-standard/react";
import { useState } from "react";
import { EncryptedValue } from "../../components/EncryptedValue";
import { Badge, Button, Field, inputCls, Mono, Note, Panel } from "../../components/ui";
import { WalletButton } from "../../components/WalletButton";
import { formatRate, formatShares, formatUsdc, parseUnits, shortAddr } from "../../lib/format";
import { useSession } from "../../lib/wallet";
import { StepList } from "./StepList";
import { useDesk } from "./useDesk";

export function Desk() {
  const s = useSession();
  if (!s.account)
    return (
      <Panel title="desk">
        <p className="mb-3 text-sm text-mute">Connect a wallet-standard wallet to borrow or lend.</p>
        <WalletButton />
      </Panel>
    );
  return <DeskFlow account={s.account} />;
}

function DeskFlow({ account }: { account: UiWalletAccount }) {
  const d = useDesk(account);
  const [wrapAmount, setWrapAmount] = useState("1000");
  const [side, setSide] = useState<0 | 1>(1);
  const [tick, setTick] = useState(8);
  const [size, setSize] = useState("1000");
  const keysReady = !!d.memberKey.data;
  const isMember = !!d.member.data;
  const configured = !!d.accounts.data?.cstock.configured;
  const decimals = d.dep.data?.decimals ?? 3;
  const busy = d.deriveKeys.isPending || d.join.isPending || d.onboard.isPending || d.wrap.isPending || d.bid.isPending;
  const err = [d.deriveKeys, d.join, d.onboard, d.wrap, d.applyPending, d.bid].find((m) => m.error)?.error;

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {d.dep.data && !d.dep.data.faucet && (
        <div className="lg:col-span-2">
          <Note tone="warn">
            The desk's demo faucet is not reachable from this browser, so joining and minting mock shares are
            unavailable. Everything that only reads the chain — the market, the explorer, and your own positions — still
            works, and so does bidding if this wallet is already a registered member.
          </Note>
        </div>
      )}
      <Panel title="1 · keys">
        <p className="text-sm text-mute">
          Your ElGamal keys are derived from two wallet signatures (member key; cSTOCK-W account key). Signatures stay
          in this tab's memory and are never sent anywhere.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Button onClick={() => d.deriveKeys.mutate()} disabled={busy || !d.accounts.data}>
            {keysReady ? "Re-derive keys" : "Derive keys (sign ×2)"}
          </Button>
          {d.memberKey.data && <EncryptedValue bytes={d.memberKey.data} label="member key" />}
        </div>
      </Panel>
      <Panel title="2 · membership">
        {isMember ? (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <Badge tone="good">member</Badge>
            <span className="text-mute">joined epoch {d.member.data?.joinedEpoch.toString()}</span>
            {d.memberKey.data && d.member.data && (
              <Badge tone={sameBytes(d.memberKey.data, d.member.data.elgamalPubkey) ? "good" : "bad"}>
                {sameBytes(d.memberKey.data, d.member.data.elgamalPubkey)
                  ? "key matches registry"
                  : "registry holds a different key"}
              </Badge>
            )}
          </div>
        ) : (
          <>
            <p className="text-sm text-mute">
              The administrator registers your wallet and key, mints 10,000 mock shares and sends 0.2 SOL for fees (demo
              faucet). Membership is a public fact; positions are not.
            </p>
            <div className="mt-3">
              <Button onClick={() => d.join.mutate()} disabled={busy || !keysReady || !d.dep.data?.faucet}>
                Join the desk
              </Button>
            </div>
          </>
        )}
      </Panel>
      <Panel title="3 · confidential account">
        {d.accounts.data ? (
          <div className="space-y-2 text-sm">
            <div>
              mock xStock <Mono>{shortAddr(d.accounts.data.mockAta)}</Mono> ·{" "}
              {d.accounts.data.mockAmount === null
                ? "not created"
                : `${formatShares(d.accounts.data.mockAmount, decimals)} shares (public balance)`}
            </div>
            <div>
              cSTOCK-W <Mono>{shortAddr(d.accounts.data.cstockAta)}</Mono> ·{" "}
              {configured ? (
                <Badge tone="good">confidential extension configured</Badge>
              ) : (
                <Badge tone="warn">not configured</Badge>
              )}
            </div>
            {configured && d.accounts.data.cstock.view && (
              <div className="flex flex-wrap items-center gap-2">
                <EncryptedValue
                  bytes={d.accounts.data.cstock.view.availableBalance}
                  label="available"
                  plaintext={d.balances.data ? formatShares(d.balances.data.available, decimals) : null}
                />
                <EncryptedValue
                  bytes={d.accounts.data.cstock.view.pendingBalanceLo}
                  label="pending"
                  plaintext={d.balances.data ? formatShares(d.balances.data.pending, decimals) : null}
                />
                {d.balances.data && d.balances.data.pending > 0n && (
                  <Button tone="mute" onClick={() => d.applyPending.mutate()} disabled={busy}>
                    Apply pending
                  </Button>
                )}
              </div>
            )}
            {!configured && (
              <Button onClick={() => d.onboard.mutate()} disabled={busy || !isMember || !d.accounts.data || !keysReady}>
                Set up confidential account
              </Button>
            )}
          </div>
        ) : (
          <p className="text-sm text-mute">{d.dep.isError ? "admin service unreachable" : "loading…"}</p>
        )}
      </Panel>
      <Panel title="4 · wrap">
        <p className="text-sm text-mute">
          Moves mock shares into custody and credits your confidential cSTOCK-W balance. The wrap leg is a public token
          transfer (Token-2022 deposits from a public balance), so wrap a round amount once, ahead of bidding.
        </p>
        <div className="mt-3 flex items-end gap-2">
          <Field label="shares">
            <input className={inputCls} value={wrapAmount} onChange={(e) => setWrapAmount(e.target.value)} />
          </Field>
          <Button
            onClick={() => {
              const v = parseUnits(wrapAmount, decimals);
              if (v && v > 0n) d.wrap.mutate(v);
            }}
            disabled={busy || !configured || !d.balances.data}
          >
            Wrap
          </Button>
        </div>
      </Panel>
      <div className="lg:col-span-2">
        <Panel title="5 · bid">
          <div className="grid gap-3 sm:grid-cols-4">
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
                  const v = parseUnits(size, 6);
                  if (v && v > 0n) d.bid.mutate({ side, tick, sizeMicroUsdc: v });
                }}
                disabled={busy || !isMember || !keysReady || !d.cfg.data?.hasOpenEpoch}
              >
                {d.bid.isPending ? "proving…" : "Submit encrypted bid"}
              </Button>
            </div>
          </div>
          <Note>
            {d.cfg.data?.hasOpenEpoch
              ? `epoch ${d.cfg.data.currentEpoch.toString()} is open · minimum ${formatUsdc(d.cfg.data.sMin)} · one bid per (side, rate)`
              : "no open epoch right now"}
            . The size is encrypted to your key and the auditor key, proven in range, and only the ciphertext goes
            on-chain; the administrator (auditor key holder) can read it; other members cannot.
          </Note>
          <StepList steps={d.steps.steps} />
          {err && <Note tone="bad">{err.message}</Note>}
        </Panel>
      </div>
    </div>
  );
}

function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

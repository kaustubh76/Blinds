/** Positions: the wallet's loans (as borrower and as lender) and its bids. Sizes render sealed. */

import type { Address } from "@solana/kit";
import { type credit, LoanStatus } from "@thewindow/solana-sdk";
import type { UiWalletAccount } from "@wallet-standard/react";
import type { ReactNode } from "react";
import { Card } from "../../components/Card";
import { Countdown } from "../../components/Countdown";
import { EmptyState } from "../../components/EmptyState";
import { EncryptedValue } from "../../components/EncryptedValue";
import { LifecycleTrack } from "../../components/LifecycleTrack";
import { ListingPicker } from "../../components/ListingPicker";
import { Skeleton } from "../../components/Skeleton";
import { TxTimeline } from "../../components/TxTimeline";
import { Badge, Button, Callout, ExplorerLink, Note, Pill } from "../../components/ui";
import { WalletButton } from "../../components/WalletButton";
import { config } from "../../config";
import { describeError } from "../../lib/chain";
import { formatPrice, formatRate, formatSlotAge, formatUsdc } from "../../lib/format";
import { listingByPda } from "../../lib/listings";
import { useBids, useSlot } from "../../lib/queries";
import { useSession } from "../../lib/wallet";
import { usePositions } from "./usePositions";

type Loan = credit.Loan;

export function Positions() {
  const s = useSession();
  if (!s.account)
    return (
      <div className="mx-auto grid max-w-[720px] gap-6 py-6 text-center">
        <div>
          <div className="t-eyebrow">positions</div>
          <h1 className="t-h1 mt-2 text-ink-1">Your loans and bids</h1>
          <p className="t-lead mx-auto mt-3 max-w-[40ch]">Sizes are ciphertexts to everyone; yours resolve here.</p>
        </div>
        <div className="flex flex-wrap justify-center gap-3">
          <WalletButton />
          <a
            href="#/desk"
            className="inline-flex items-center rounded-[var(--radius-md)] border border-line bg-surface-1 px-3.5 py-2 text-sm text-ink-1 hover:bg-surface-2"
          >
            or take a burner on the desk →
          </a>
        </div>
      </div>
    );
  return <PositionsFor account={s.account} />;
}

function PositionsFor({ account }: { account: UiWalletAccount }) {
  const p = usePositions(account);
  const bids = useBids(p.wallet);
  const slot = useSlot();
  const err = p.lock.error ?? p.deposit.error ?? p.receiveAccount.error;
  const cluster = config.cluster;
  const borrowed = p.loans.data?.borrowed ?? [];
  const lent = p.loans.data?.lent ?? [];

  const card = (address: Address, loan: Loan, role: "borrower" | "lender") => {
    const matured =
      loan.status === LoanStatus.Active &&
      slot.data !== undefined &&
      loan.deadlineSlot > 0n &&
      Number(loan.deadlineSlot) < slot.data;
    const bound = listingByPda(p.listings, loan.listing);
    const action =
      role === "borrower" && loan.status === LoanStatus.Pending ? (
        <span className="flex flex-wrap items-center gap-3">
          <ListingPicker
            listings={p.listings}
            selected={p.selectedListing}
            onSelect={p.selectListing}
            disabled={p.lock.isPending}
          />
          <Button
            onClick={() => p.lock.mutate({ address, loan, listing: p.selectedListing })}
            loading={p.lock.isPending}
            disabled={!p.keysReady || !p.selectedListing}
            icon="shield"
          >
            Prove solvency & lock{p.selectedListing ? ` · ${p.selectedListing.symbol}` : ""}
          </Button>
        </span>
      ) : role === "borrower" && loan.status === LoanStatus.Requested ? (
        <Button
          onClick={() => p.deposit.mutate({ address, loan })}
          loading={p.deposit.isPending}
          disabled={!p.keysReady}
          icon="lock"
        >
          Transfer collateral to escrow
        </Button>
      ) : role === "borrower" && loan.status === LoanStatus.Deposited ? (
        <span className="text-xs text-ink-3">awaiting the operator's confirmation</span>
      ) : loan.status === LoanStatus.Locked ? (
        <span className="text-xs text-ink-3">awaiting funding confirmation</span>
      ) : role === "lender" && loan.status === LoanStatus.Defaulted && !loan.collateralReleased && bound ? (
        // The payout is that listing's cSTOCK-W; the operator releases it the moment an account exists.
        <span className="flex flex-wrap items-center gap-2">
          <Button
            onClick={() => p.receiveAccount.mutate({ loan })}
            loading={p.receiveAccount.isPending}
            disabled={!p.keysReady}
            icon="key"
          >
            Receive the payout · set up a {bound.symbol} account
          </Button>
          <span className="text-xs text-ink-3">
            the seized collateral is {bound.symbol}; the operator sends it once you hold an account there
          </span>
        </span>
      ) : role === "lender" && loan.status === LoanStatus.Defaulted && !loan.collateralReleased ? (
        <Note tone="warn">
          A listing this dashboard does not know — open it against the deployment that carries it.
        </Note>
      ) : null;
    return (
      <li key={address} className="rounded-[var(--radius-xl)] border border-line bg-surface-1 p-5">
        <div className="flex flex-wrap items-center gap-2">
          <Pill tone={role === "borrower" ? "borrow" : "lend"}>{role === "borrower" ? "borrowing" : "lending"}</Pill>
          {bound && (
            <Pill tone="mute" icon="shield">
              {bound.symbol.replace(/-mock$/, "")} · {Number(bound.haircutBps) / 100}%
            </Pill>
          )}
          <span className="num text-xl font-semibold text-ink-1">{formatRate(loan.tick)}</span>
          <span className="text-xs text-ink-3">
            epoch {loan.epoch.toString()} · match #{loan.k}
          </span>
          <span className="ml-auto flex items-center gap-3">
            {loan.deadlineSlot > 0n && slot.data !== undefined && Number(loan.deadlineSlot) > slot.data && (
              <Countdown slots={Number(loan.deadlineSlot) - slot.data} label="to maturity" className="text-sm" />
            )}
            <ExplorerLink address={address} cluster={cluster} />
          </span>
        </div>
        <div className="mt-3">
          <LifecycleTrack status={loan.status} matured={matured} />
        </div>
        <dl className="mt-3 grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
          <Row k="size" v={<EncryptedValue bytes={loan.sizeCt} size="sm" />} />
          <Row
            k={role === "borrower" ? "lender" : "borrower"}
            v={<ExplorerLink address={role === "borrower" ? loan.lender : loan.borrower} cluster={cluster} />}
          />
          {loan.status >= LoanStatus.Requested && (
            <Row k="collateral" v={<EncryptedValue bytes={loan.collateralCt} size="sm" />} />
          )}
          {loan.priceAtLock > 0n && (
            <Row k="price at lock" v={<span className="num">{formatPrice(loan.priceAtLock, -2)}</span>} />
          )}
          {loan.fillDen > 0n && (loan.fillNum !== 1n || loan.fillDen !== 1n) && (
            <Row
              k="marginal fill"
              v={
                <span className="num">
                  {((Number(loan.fillNum) * 100) / Number(loan.fillDen)).toFixed(1)}% · {formatUsdc(loan.fillNum)} of{" "}
                  {formatUsdc(loan.fillDen)}
                </span>
              }
            />
          )}
          {loan.deadlineSlot > 0n && slot.data !== undefined && (
            <Row
              k="deadline"
              v={
                <span className="num">
                  {Number(loan.deadlineSlot) > slot.data
                    ? `in ${formatSlotAge(Number(loan.deadlineSlot) - slot.data)}`
                    : `${formatSlotAge(slot.data - Number(loan.deadlineSlot))} ago`}
                </span>
              }
            />
          )}
        </dl>
        {action && <div className="mt-3">{action}</div>}
      </li>
    );
  };

  const active = [...borrowed, ...lent].filter((l) => l.data.status === LoanStatus.Active).length;
  const pending = borrowed.filter((l) => l.data.status === LoanStatus.Pending).length;
  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="t-eyebrow">positions</div>
          <h1 className="t-h1 mt-1 text-ink-1">Your loans and bids</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <Pill tone="borrow">{borrowed.length} borrowing</Pill>
          <Pill tone="lend">{lent.length} lending</Pill>
          <Pill tone="good">{active} funded</Pill>
          {pending > 0 && (
            <Pill tone="accent" icon="zap">
              {pending} to lock
            </Pill>
          )}
        </div>
      </div>
      {!p.keysReady && (
        <Callout icon="key" tone="warn" title="Derive your keys to act on loans">
          Reading needs nothing; locking and depositing need the key this tab derives — asked again after a reload.{" "}
          <Button
            size="sm"
            icon="key"
            onClick={() => p.deriveKeys.mutate()}
            loading={p.deriveKeys.isPending}
            disabled={p.deriveKeys.isPending}
          >
            Sign to derive
          </Button>
        </Callout>
      )}
      {/* One timeline and one error for the page: `usePositions` shares a single step list across
          locking, depositing and a lender's payout, so neither belongs inside one of the cards. */}
      <TxTimeline steps={p.steps.steps} cluster={cluster} />
      {err && <Note tone="bad">{describeError(err)}</Note>}
      <Card eyebrow="borrowing" title={`${borrowed.length} loan${borrowed.length === 1 ? "" : "s"}`}>
        {p.loans.data === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : borrowed.length === 0 ? (
          <EmptyState
            icon="zap"
            title="No loans as a borrower yet."
            action={
              <a href="#/desk" className="text-sm text-accent hover:underline">
                Seal a borrow bid on the desk →
              </a>
            }
          >
            A bid at or above the clearing rate becomes a loan when the administrator posts matches after the print.
          </EmptyState>
        ) : (
          <ul className="grid gap-3">{borrowed.map((l) => card(l.address, l.data, "borrower"))}</ul>
        )}
      </Card>
      <Card
        eyebrow="lending"
        title={`${lent.length} loan${lent.length === 1 ? "" : "s"}`}
        footer="A lender is told the size off chain — the disclosed surface."
      >
        {p.loans.data === undefined ? (
          <Skeleton className="h-16 w-full" />
        ) : lent.length === 0 ? (
          <EmptyState title="No loans as a lender yet.">
            An ask at or below the clearing rate is filled — pro rata at the marginal rate.
          </EmptyState>
        ) : (
          <ul className="grid gap-3">{lent.map((l) => card(l.address, l.data, "lender"))}</ul>
        )}
      </Card>
      <Card eyebrow="bids on chain" title={`${bids.data?.length ?? 0} sealed`}>
        {bids.data && bids.data.length > 0 ? (
          <ul className="grid gap-1.5 text-sm">
            {bids.data
              .slice()
              .sort((a, b) => Number(b.data.epoch - a.data.epoch))
              .map((b) => (
                <li key={b.address} className="flex flex-wrap items-center gap-3">
                  <span className="mono text-xs text-ink-3">epoch {b.data.epoch.toString()}</span>
                  <Badge tone={b.data.side === 1 ? "borrow" : "lend"}>{b.data.side === 1 ? "borrow" : "lend"}</Badge>
                  <span>{formatRate(b.data.tick)}</span>
                  <EncryptedValue bytes={b.data.ciphertext} size="sm" />
                  <span className="mono text-xs text-ink-3">slot {b.data.slot.toString()}</span>
                </li>
              ))}
          </ul>
        ) : (
          <EmptyState title="No bids on chain.">
            Bids whose epoch has settled are closed by the keeper and their rent returned to you.
          </EmptyState>
        )}
      </Card>
    </div>
  );
}

function Row({ k, v }: { k: string; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-2 border-b border-line py-1">
      <dt className="text-ink-3">{k}</dt>
      <dd className="text-ink-1">{v}</dd>
    </div>
  );
}

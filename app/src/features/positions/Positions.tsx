/** Positions: the wallet's loans (as borrower and as lender) and its bids. Sizes render sealed. */

import type { Address } from "@solana/kit";
import { type credit, LoanStatus } from "@thewindow/solana-sdk";
import type { UiWalletAccount } from "@wallet-standard/react";
import type { ReactNode } from "react";
import { Card } from "../../components/Card";
import { EmptyState } from "../../components/EmptyState";
import { EncryptedValue } from "../../components/EncryptedValue";
import { LifecycleTrack } from "../../components/LifecycleTrack";
import { TxTimeline } from "../../components/TxTimeline";
import { Badge, Button, ExplorerLink, Note } from "../../components/ui";
import { WalletButton } from "../../components/WalletButton";
import { config } from "../../config";
import { formatPrice, formatRate, formatSlotAge } from "../../lib/format";
import { useBids, useSlot } from "../../lib/queries";
import { useSession } from "../../lib/wallet";
import { usePositions } from "./usePositions";

type Loan = credit.Loan;

export function Positions() {
  const s = useSession();
  if (!s.account)
    return (
      <Card eyebrow="positions" title="Your loans and bids">
        <EmptyState icon="wallet" title="Connect a wallet to see its positions." action={<WalletButton />}>
          Loan sizes and collateral render as ciphertexts for everyone; only your own resolve here, decrypted in this
          tab.
        </EmptyState>
      </Card>
    );
  return <PositionsFor account={s.account} />;
}

function PositionsFor({ account }: { account: UiWalletAccount }) {
  const p = usePositions(account);
  const bids = useBids(p.wallet);
  const slot = useSlot();
  const err = p.lock.error ?? p.deposit.error;
  const cluster = config.cluster;
  const borrowed = p.loans.data?.borrowed ?? [];
  const lent = p.loans.data?.lent ?? [];

  const card = (address: Address, loan: Loan, role: "borrower" | "lender") => {
    const matured =
      loan.status === LoanStatus.Active &&
      slot.data !== undefined &&
      loan.deadlineSlot > 0n &&
      Number(loan.deadlineSlot) < slot.data;
    const action =
      role === "borrower" && loan.status === LoanStatus.Pending ? (
        <Button
          onClick={() => p.lock.mutate({ address, loan })}
          loading={p.lock.isPending}
          disabled={!p.keysReady}
          icon="shield"
        >
          Prove solvency & lock
        </Button>
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
      ) : null;
    return (
      <li key={address} className="rounded-[var(--radius-lg)] border border-line bg-surface-1 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone={role === "borrower" ? "borrow" : "lend"}>{role}</Badge>
          <span className="text-sm font-medium text-ink-1">{formatRate(loan.tick)}</span>
          <span className="mono text-xs text-ink-3">
            epoch {loan.epoch.toString()} · #{loan.k}
          </span>
          <span className="ml-auto">
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
            <Row k="price at lock" v={<span className="num">{formatPrice(loan.priceAtLock, -8)}</span>} />
          )}
          {loan.fillDen > 0n && (loan.fillNum !== 1n || loan.fillDen !== 1n) && (
            <Row
              k="marginal fill"
              v={
                <span className="num">
                  {loan.fillNum.toString()} / {loan.fillDen.toString()}
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

  return (
    <div className="grid gap-4">
      {!p.keysReady && (
        <Note tone="warn">Derive your keys on the Desk to act on loans; reading them needs nothing.</Note>
      )}
      <Card eyebrow="borrowing" title={`${borrowed.length} loan${borrowed.length === 1 ? "" : "s"}`}>
        {borrowed.length === 0 ? (
          <EmptyState title="No loans as a borrower yet.">
            A bid at or above the clearing rate becomes a loan when the administrator posts matches after the print.
          </EmptyState>
        ) : (
          <ul className="grid gap-3">{borrowed.map((l) => card(l.address, l.data, "borrower"))}</ul>
        )}
        <TxTimeline steps={p.steps.steps} cluster={cluster} />
        {err && <Note tone="bad">{err.message}</Note>}
      </Card>
      <Card
        eyebrow="lending"
        title={`${lent.length} loan${lent.length === 1 ? "" : "s"}`}
        footer="As a lender you are told the loan size by the administrator off chain (the disclosed surface); funding and repayment are confirmed by the administrator on chain."
      >
        {lent.length === 0 ? (
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

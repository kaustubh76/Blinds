/** Positions: the wallet's loans (as borrower and as lender) and its bids. Sizes render as ciphertexts. */

import type { credit } from "@thewindow/solana-sdk";
import { LOAN_STATUS_NAMES, LoanStatus } from "@thewindow/solana-sdk";

type Loan = credit.Loan;

import type { Address } from "@solana/kit";
import type { UiWalletAccount } from "@wallet-standard/react";
import { EncryptedValue } from "../../components/EncryptedValue";
import { Badge, Button, Note, Panel } from "../../components/ui";
import { WalletButton } from "../../components/WalletButton";
import { formatRate, shortAddr } from "../../lib/format";
import { useBids, useSlot } from "../../lib/queries";
import { useSession } from "../../lib/wallet";
import { StepList } from "../desk/StepList";
import { usePositions } from "./usePositions";

export function Positions() {
  const s = useSession();
  if (!s.account)
    return (
      <Panel title="positions">
        <p className="mb-3 text-sm text-mute">Connect a wallet to see its loans and bids.</p>
        <WalletButton />
      </Panel>
    );
  return <PositionsFor account={s.account} />;
}

const tone = (status: number) =>
  status === LoanStatus.Active
    ? "accent"
    : status === LoanStatus.Repaid
      ? "good"
      : status === LoanStatus.Defaulted
        ? "bad"
        : "mute";

function PositionsFor({ account }: { account: UiWalletAccount }) {
  const p = usePositions(account);
  const bids = useBids(p.wallet);
  const slot = useSlot();
  const err = p.lock.error ?? p.deposit.error;
  const row = (address: Address, loan: Loan, role: "borrower" | "lender") => (
    <tr key={address} className="border-t border-line align-top">
      <td className="py-2 font-mono text-xs">{shortAddr(address)}</td>
      <td>{loan.epoch.toString()}</td>
      <td>{formatRate(loan.tick)}</td>
      <td>
        <Badge tone={tone(loan.status)}>{LOAN_STATUS_NAMES[loan.status] ?? loan.status}</Badge>
      </td>
      <td className="font-mono text-xs">{shortAddr(role === "borrower" ? loan.lender : loan.borrower)}</td>
      <td>
        <EncryptedValue bytes={loan.sizeCt} />
      </td>
      <td className="text-xs text-mute">
        {loan.fillNum.toString()}/{loan.fillDen.toString()}
        {loan.status >= LoanStatus.Active && loan.deadlineSlot > 0n && (
          <div>
            due slot {loan.deadlineSlot.toString()}
            {slot.data !== undefined && Number(loan.deadlineSlot) < slot.data && loan.status === LoanStatus.Active
              ? " · matured"
              : ""}
          </div>
        )}
      </td>
      <td>
        {role === "borrower" && loan.status === LoanStatus.Pending && (
          <Button onClick={() => p.lock.mutate({ address, loan })} disabled={p.lock.isPending || !p.keysReady}>
            {p.lock.isPending ? "proving…" : "Lock collateral"}
          </Button>
        )}
        {role === "borrower" && loan.status === LoanStatus.Requested && (
          <Button onClick={() => p.deposit.mutate({ address, loan })} disabled={p.deposit.isPending || !p.keysReady}>
            {p.deposit.isPending ? "proving…" : "Deposit to escrow"}
          </Button>
        )}
        {role === "borrower" && loan.status === LoanStatus.Deposited && (
          <span className="text-xs text-mute">awaiting operator confirm</span>
        )}
        {loan.status === LoanStatus.Locked && <span className="text-xs text-mute">awaiting funding confirmation</span>}
      </td>
    </tr>
  );
  const table = (rows: Array<{ address: Address; data: Loan }>, role: "borrower" | "lender") =>
    rows.length === 0 ? (
      <p className="text-sm text-mute">none</p>
    ) : (
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-mute">
            <tr>
              <th>loan</th>
              <th>epoch</th>
              <th>rate</th>
              <th>status</th>
              <th>{role === "borrower" ? "lender" : "borrower"}</th>
              <th>size (ciphertext)</th>
              <th>fill</th>
              <th />
            </tr>
          </thead>
          <tbody>{rows.map((r) => row(r.address, r.data, role))}</tbody>
        </table>
      </div>
    );
  return (
    <div className="grid gap-4">
      {!p.keysReady && <Note tone="warn">Derive your keys on the Desk tab to act on loans.</Note>}
      <Panel title="borrowing">
        {table(p.loans.data?.borrowed ?? [], "borrower")}
        <StepList steps={p.steps.steps} />
        {err && <Note tone="bad">{err.message}</Note>}
      </Panel>
      <Panel title="lending">
        {table(p.loans.data?.lent ?? [], "lender")}
        <Note>
          As a lender you are told the loan size by the administrator off-chain (disclosed surface); funding and
          repayment are confirmed by the administrator on-chain.
        </Note>
      </Panel>
      <Panel title="bids on-chain">
        {bids.data && bids.data.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {bids.data
              .slice()
              .sort((a, b) => Number(b.data.epoch - a.data.epoch))
              .map((b) => (
                <li key={b.address} className="flex flex-wrap items-center gap-3">
                  <span className="text-mute">epoch {b.data.epoch.toString()}</span>
                  <Badge>{b.data.side === 1 ? "borrow" : "lend"}</Badge>
                  <span>{formatRate(b.data.tick)}</span>
                  <EncryptedValue bytes={b.data.ciphertext} />
                </li>
              ))}
          </ul>
        ) : (
          <p className="text-sm text-mute">none</p>
        )}
      </Panel>
    </div>
  );
}

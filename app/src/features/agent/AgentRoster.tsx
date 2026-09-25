/**
 * The six simulated members, one row each, with what the chain says about them.
 *
 * The page used to show two numbers — "3 lender agents, 3 borrower agents" — read off the deployment
 * descriptor. The descriptor also names each one's wallet, so each is an address you can look up: its
 * sealed bids this window, the loans it sits on either side of, the rate it quoted. That is the
 * difference between being told there are agents and being able to check.
 *
 * Reading the chain is opt-in per row. Six agents is twelve `getProgramAccounts` calls, and on a
 * public devnet RPC that is not free — so nothing is fetched until you ask for that row, and the
 * descriptor half (role, listing, wallet) costs nothing and is always shown.
 */
import { type Address, address, isAddress } from "@solana/kit";
import { LOAN_STATUS_NAMES } from "@thewindow/solana-sdk";
import { useState } from "react";
import { Icon } from "../../components/Icon";
import { Badge, Button, ExplorerLink, Note } from "../../components/ui";
import { config } from "../../config";
import { formatRate, shortAddr } from "../../lib/format";
import { useBids, useLoans } from "../../lib/queries";

export interface RosterAgent {
  index: number;
  /** As the descriptor spells it. A descriptor written by an older `setup` may not carry one. */
  wallet?: string | undefined;
  role: string;
  listing?: number | undefined;
  symbol?: string | undefined;
}

const cluster = () => (config.cluster === "devnet" ? "devnet" : "custom");

export function AgentRoster({ agents }: { agents: RosterAgent[] }) {
  const [open, setOpen] = useState<Set<number>>(new Set());
  const addressable = agents.filter((a) => a.wallet).length;
  const allOpen = addressable > 0 && open.size === addressable;
  if (agents.length === 0)
    return <Note>This deployment descriptor names no simulated members, so there is no roster to read.</Note>;
  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="mono text-[11px] uppercase tracking-[0.14em] text-ink-3">
          {agents.length} simulated members · from the descriptor
        </div>
        <Button
          size="sm"
          variant="ghost"
          icon={allOpen ? "eyeOff" : "eye"}
          disabled={!agents.some((a) => a.wallet)}
          onClick={() => setOpen(allOpen ? new Set() : new Set(agents.filter((a) => a.wallet).map((a) => a.index)))}
        >
          {allOpen ? "stop reading the chain" : `read the chain for all ${agents.length}`}
        </Button>
      </div>
      <ul className="grid gap-2">
        {agents.map((a) => (
          <AgentRow
            key={a.index}
            agent={a}
            open={open.has(a.index)}
            onToggle={() =>
              setOpen((prev) => {
                const next = new Set(prev);
                if (next.has(a.index)) next.delete(a.index);
                else next.add(a.index);
                return next;
              })
            }
          />
        ))}
      </ul>
    </div>
  );
}

function AgentRow({ agent, open, onToggle }: { agent: RosterAgent; open: boolean; onToggle: () => void }) {
  // A descriptor from before the agents carried wallets, or a hand-edited one: say so rather than
  // crashing the page on an address that is not there.
  const wallet = agent.wallet && isAddress(agent.wallet) ? agent.wallet : null;
  return (
    <li className="rounded-[var(--radius-md)] border border-line bg-surface-1 px-3 py-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Badge tone={agent.role === "lender" ? "lend" : "borrow"}>{agent.role}</Badge>
        <span className="mono text-ink-3">#{agent.index}</span>
        {wallet ? (
          <ExplorerLink address={wallet} cluster={cluster()} />
        ) : (
          <span className="text-ink-3">no wallet in this descriptor</span>
        )}
        {agent.symbol && <span className="text-ink-2">{agent.symbol}</span>}
        {wallet && (
          <span className="ml-auto">
            <Button size="sm" variant="ghost" icon={open ? "chevronLeft" : "chevronRight"} onClick={onToggle}>
              {open ? "stop" : "read the chain"}
            </Button>
          </span>
        )}
      </div>
      {open && wallet && <OnChain wallet={address(wallet)} />}
    </li>
  );
}

/** The two program-account scans, mounted only while a row is open so a closed row costs nothing. */
function OnChain({ wallet }: { wallet: Address }) {
  const bids = useBids(wallet);
  const loans = useLoans(wallet);
  if (bids.isLoading || loans.isLoading) return <p className="mt-2 text-xs text-ink-3">reading…</p>;
  if (bids.isError || loans.isError)
    return (
      <p className="mt-2 text-xs text-status-warning">
        <Icon name="alert" size={11} className="mr-1 inline" />
        the RPC refused the scan — a public endpoint often does
      </p>
    );
  const sealed = bids.data ?? [];
  const lent = loans.data?.lent ?? [];
  const borrowed = loans.data?.borrowed ?? [];
  const latest = [...sealed].sort((a, b) => Number(b.data.slot - a.data.slot)).slice(0, 4);
  return (
    <div className="mt-2 grid gap-2 border-t border-line pt-2 text-xs">
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-ink-2">
        <span>
          <b className="text-ink-1">{sealed.length}</b> sealed bid{sealed.length === 1 ? "" : "s"}
        </span>
        <span>
          <b className="text-ink-1">{lent.length}</b> lent
        </span>
        <span>
          <b className="text-ink-1">{borrowed.length}</b> borrowed
        </span>
      </div>
      {latest.length > 0 && (
        <ul className="grid gap-1">
          {latest.map((b) => (
            <li key={b.address} className="flex flex-wrap items-center gap-2">
              <span className="mono text-ink-3">epoch {b.data.epoch.toString()}</span>
              <Badge tone={b.data.side === 0 ? "lend" : "borrow"}>{b.data.side === 0 ? "ask" : "bid"}</Badge>
              <span className="text-ink-1">{formatRate(b.data.tick)}</span>
              <span className="mono text-ink-3">size sealed · {b.data.ciphertext.length} bytes of ciphertext</span>
            </li>
          ))}
        </ul>
      )}
      {(lent.length > 0 || borrowed.length > 0) && (
        <div className="flex flex-wrap gap-1.5">
          {[...lent, ...borrowed].slice(0, 6).map((l) => (
            <Badge key={l.address} tone="mute">
              {shortAddr(l.address)} · {LOAN_STATUS_NAMES[l.data.status] ?? l.data.status} @ {formatRate(l.data.tick)}
            </Badge>
          ))}
        </div>
      )}
      {sealed.length === 0 && lent.length === 0 && borrowed.length === 0 && (
        <p className="text-ink-3">
          nothing on chain for this wallet yet — bids are closed after a print, so an idle window leaves none
        </p>
      )}
    </div>
  );
}

import { useState } from "react";
import { chain } from "../config";
import { shortAddr } from "../lib/format";
import { useSession } from "../lib/wallet";
import { Icon } from "./Icon";
import { Button } from "./ui";

export function WalletButton() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (s.account) {
    const supported = s.account.chains.includes(chain);
    return (
      <div className="flex items-center gap-2">
        {!supported && <span className="text-xs text-status-warning">wallet has no {chain} account</span>}
        <span className="mono text-xs text-ink-2">{shortAddr(s.account.address, 6)}</span>
        <Button variant="ghost" size="sm" onClick={() => void s.disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Button size="sm" icon="wallet" onClick={() => setOpen((o) => !o)}>
        Connect
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-60 rounded-[var(--radius-md)] border border-line bg-surface-1 p-1.5">
          {s.wallets.length === 0 && (
            <p className="flex items-center gap-2 p-2 text-xs text-ink-3">
              <Icon name="alert" size={12} /> No wallet-standard wallet detected.
            </p>
          )}
          {s.wallets.map((w) => (
            <button
              type="button"
              key={w.name}
              className="flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm text-ink-1 hover:bg-surface-2"
              onClick={() => {
                setError(null);
                s.connect(w)
                  .then(() => setOpen(false))
                  .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
              }}
            >
              <img src={w.icon} alt="" className="h-5 w-5 rounded" />
              {w.name}
            </button>
          ))}
          {error && <p className="p-2 text-xs text-status-critical">{error}</p>}
        </div>
      )}
    </div>
  );
}

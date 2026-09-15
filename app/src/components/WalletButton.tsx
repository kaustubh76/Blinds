import { useState } from "react";
import { chain } from "../config";
import { shortAddr } from "../lib/format";
import { useSession } from "../lib/wallet";
import { Button } from "./ui";

export function WalletButton() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (s.account) {
    const supported = s.account.chains.includes(chain);
    return (
      <div className="flex items-center gap-2">
        {!supported && <span className="text-xs text-warn">wallet has no {chain} account</span>}
        <span className="font-mono text-xs">{shortAddr(s.account.address, 6)}</span>
        <Button tone="mute" onClick={() => void s.disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Button onClick={() => setOpen((o) => !o)}>Connect wallet</Button>
      {open && (
        <div className="absolute right-0 z-10 mt-2 w-56 rounded border border-line bg-panel p-2 shadow-lg">
          {s.wallets.length === 0 && <p className="p-2 text-xs text-mute">No wallet-standard wallet detected.</p>}
          {s.wallets.map((w) => (
            <button
              type="button"
              key={w.name}
              className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-line"
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
          {error && <p className="p-2 text-xs text-bad">{error}</p>}
        </div>
      )}
    </div>
  );
}

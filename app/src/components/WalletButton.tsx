import { useState } from "react";
import { chain } from "../config";
import { BURNER_WALLET_NAME, burnerAddress, createBurner, hasBurner } from "../lib/burner";
import { shortAddr } from "../lib/format";
import { useSession } from "../lib/wallet";
import { Icon } from "./Icon";
import { Badge, Button } from "./ui";

export function WalletButton() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (s.account) {
    const supported = s.account.chains.includes(chain);
    const isBurner = s.wallet?.name === BURNER_WALLET_NAME;
    return (
      <div className="flex items-center gap-2">
        {!supported && <span className="text-xs text-status-warning">wallet has no {chain} account</span>}
        {isBurner && (
          <Badge tone="accent" icon="key">
            burner
          </Badge>
        )}
        <span className="mono text-xs text-ink-2">{shortAddr(s.account.address, 4)}</span>
        <Button variant="ghost" size="sm" onClick={() => void s.disconnect()}>
          Disconnect
        </Button>
      </div>
    );
  }
  const extensions = s.wallets.filter((w) => w.name !== BURNER_WALLET_NAME);
  const burner = s.wallets.find((w) => w.name === BURNER_WALLET_NAME);
  const pick = (run: () => Promise<unknown>) => {
    setError(null);
    run()
      .then(() => setOpen(false))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));
  };
  const item =
    "flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm text-ink-1 hover:bg-surface-2";
  return (
    <div className="relative">
      <Button size="sm" icon="wallet" onClick={() => setOpen((o) => !o)}>
        Connect
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 w-64 rounded-[var(--radius-md)] border border-line bg-surface-1 p-1.5">
          {extensions.length === 0 && (
            <p className="flex items-center gap-2 p-2 text-xs text-ink-3">
              <Icon name="alert" size={12} /> No wallet extension detected.
            </p>
          )}
          {extensions.map((w) => (
            <button type="button" key={w.name} className={item} onClick={() => pick(() => s.connect(w))}>
              <img src={w.icon} alt="" className="h-5 w-5 rounded" />
              {w.name}
            </button>
          ))}
          {burner && (
            <>
              <div className="my-1 border-t border-line" />
              <button
                type="button"
                className={item}
                onClick={() =>
                  pick(async () => {
                    if (!hasBurner()) await createBurner();
                    await s.connect(burner);
                  })
                }
              >
                <Icon name="key" size={14} className="text-accent" />
                <span className="flex flex-col">
                  <span>
                    {hasBurner() ? `Use burner ${shortAddr(burnerAddress() ?? "", 4)}` : "Create a devnet burner"}
                  </span>
                  <span className="text-[11px] text-ink-3">a throwaway key kept in this browser</span>
                </span>
              </button>
            </>
          )}
          {error && <p className="p-2 text-xs text-status-critical">{error}</p>}
        </div>
      )}
    </div>
  );
}

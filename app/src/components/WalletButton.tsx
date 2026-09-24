/**
 * The header's wallet control: one chip that opens one menu, connected or not. The chip stays
 * narrow because it shares a 390px header with the brand, the theme toggle and the gear — the full
 * address, the chain warning and Disconnect live in the menu rather than in the header row.
 */
import { type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { chain, config } from "../config";
import { BURNER_WALLET_NAME, burnerAddress, createBurner, hasBurner } from "../lib/burner";
import { shortAddr } from "../lib/format";
import { BELOW_SM, useMediaQuery } from "../lib/useMediaQuery";
import { useSession } from "../lib/wallet";
import { Icon } from "./Icon";
import { Badge, Button, ExplorerLink, Note } from "./ui";

const PANEL =
  "rounded-[var(--radius-md)] border border-line bg-surface-1 p-1.5 shadow-[0_18px_40px_-24px_rgba(0,0,0,0.6)]";
/** Wide enough for a chip to anchor: an ordinary dropdown under the trigger. */
const DROPDOWN = `absolute right-0 z-30 mt-2 w-64 ${PANEL}`;
/**
 * Phones: a sheet pinned to the viewport, above the tab bar. Anchoring 16rem to a chip 218px from
 * the left edge of a 390px screen would start it at -38px, and the body's `overflow-x: hidden`
 * deletes those pixels. It is `fixed`, so it has to be *portalled* — see `sheet` below.
 */
const SHEET = `fixed inset-x-3 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-50 ${PANEL}`;
const ITEM =
  "flex w-full items-center gap-2 rounded-[var(--radius-sm)] px-2 py-1.5 text-left text-sm text-ink-1 hover:bg-surface-2";

/**
 * Closes the menu on a click outside it or on Escape; neither should need a second tap on a phone.
 * Two nodes count as "inside": the trigger, and the panel — which on a phone is portalled out of the
 * trigger's subtree, so DOM containment alone would treat every tap in the menu as a tap outside.
 */
function useDismiss(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      const t = e.target as Node;
      if (!ref.current?.contains(t) && !panelRef.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return { ref, panelRef };
}

export function WalletButton() {
  const s = useSession();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const close = useCallback(() => {
    setOpen(false);
    setError(null);
  }, []);
  const { ref, panelRef } = useDismiss(open, close);
  // A `fixed` panel inside the header would anchor to the *header*, not the viewport: `backdrop-blur`
  // there makes it a containing block, which put the sheet at top:-111 — entirely off screen. So the
  // sheet is portalled to the body, which also lifts it clear of the header's stacking context.
  const sheet = useMediaQuery(BELOW_SM);
  const panel = (kind: string, children: ReactNode) => {
    const el = (
      <div ref={panelRef} className={sheet ? SHEET : DROPDOWN} data-wallet-menu={kind}>
        {children}
      </div>
    );
    return sheet && typeof document !== "undefined" ? createPortal(el, document.body) : el;
  };
  // Connecting or disconnecting swaps the branch under the menu; neither should leave it hanging
  // open over the other one's contents, nor keep a stale connect failure to show next time.
  const address = s.account?.address ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: the identity change is the signal.
  useEffect(() => {
    close();
  }, [address, close]);

  if (s.account) {
    const supported = s.account.chains.includes(chain);
    const isBurner = s.wallet?.name === BURNER_WALLET_NAME;
    return (
      <div className="relative" ref={ref}>
        <Button
          variant="ghost"
          size="sm"
          icon={!supported ? "alert" : isBurner ? "key" : "wallet"}
          onClick={() => setOpen((o) => !o)}
          title={supported ? s.account.address : `no ${chain} account in this wallet`}
          expanded={open}
          hasPopup
          className={`${!supported ? "border-status-warning/60 text-status-warning" : ""} ${
            open ? "border-accent/60" : ""
          }`}
        >
          <span className="mono text-[11px]">{shortAddr(s.account.address, 4)}</span>
        </Button>
        {open &&
          panel(
            "account",
            <>
              <div className="px-2 py-1.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-ink-1">{s.wallet?.name ?? "wallet"}</span>
                  {isBurner && (
                    <Badge tone="accent" icon="key">
                      burner
                    </Badge>
                  )}
                </div>
                <code className="mono mt-1 block break-all text-[11px] leading-relaxed text-ink-2">
                  {s.account.address}
                </code>
                <div className="mt-1.5">
                  <ExplorerLink address={s.account.address} cluster={config.cluster} />
                </div>
                {!supported && <Note tone="warn">This wallet has no {chain} account — signing will fail.</Note>}
              </div>
              <div className="my-1 border-t border-line" />
              <button
                type="button"
                className={ITEM}
                onClick={() => {
                  setOpen(false);
                  void s.disconnect();
                }}
              >
                <Icon name="x" size={14} className="text-ink-3" />
                Disconnect
              </button>
            </>,
          )}
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
  return (
    <div className="relative" ref={ref}>
      <Button size="sm" icon="wallet" onClick={() => setOpen((o) => !o)} expanded={open} hasPopup>
        Connect
      </Button>
      {open &&
        panel(
          "connect",
          <>
            {extensions.length === 0 && (
              <p className="flex items-center gap-2 p-2 text-xs text-ink-3">
                <Icon name="alert" size={12} /> No wallet extension detected.
              </p>
            )}
            {extensions.map((w) => (
              <button type="button" key={w.name} className={ITEM} onClick={() => pick(() => s.connect(w))}>
                <img src={w.icon} alt="" className="h-5 w-5 rounded" />
                {w.name}
              </button>
            ))}
            {burner && (
              <>
                <div className="my-1 border-t border-line" />
                <button
                  type="button"
                  className={ITEM}
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
          </>,
        )}
    </div>
  );
}

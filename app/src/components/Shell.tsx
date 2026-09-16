/** The page frame: brand, live ticker, wallet; a segmented nav with 1–4 shortcuts; the honest footer. */
import { type ReactNode, useEffect } from "react";
import { config } from "../config";
import { TABS, type Tab, useHashRoute } from "../lib/useHashRoute";
import { Ticker } from "./Ticker";
import { WalletButton } from "./WalletButton";

const LABEL: Record<Tab, string> = { market: "Market", explorer: "Explorer", desk: "Desk", positions: "Positions" };

export function Shell({ tab, children }: { tab: Tab; children: ReactNode }) {
  const { go } = useHashRoute();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = (e.target as HTMLElement | null)?.tagName;
      if (t === "INPUT" || t === "SELECT" || t === "TEXTAREA") return;
      const i = Number(e.key) - 1;
      const target = TABS[i];
      if (target) go(target);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go]);

  return (
    <div className="min-h-screen bg-surface-0 text-ink-1">
      <header className="sticky top-0 z-20 border-b border-line bg-surface-0/90 backdrop-blur">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center gap-x-5 gap-y-2 px-5 py-2.5 xl:flex-nowrap">
          <a href="#/market" className="flex items-baseline gap-2">
            <span className="text-[15px] font-semibold tracking-tight text-ink-1">THE WINDOW</span>
            <span className="text-xs text-ink-3">for Stocks</span>
            <span className="mono rounded-[var(--radius-sm)] border border-line px-1.5 text-[10px] uppercase tracking-[0.12em] text-ink-3">
              {config.cluster}
            </span>
          </a>
          <div className="hidden min-w-0 lg:block">
            <Ticker />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-3">
            <nav className="flex rounded-[var(--radius-md)] border border-line p-0.5" aria-label="Sections">
              {TABS.map((t, i) => (
                <a
                  key={t}
                  href={`#/${t}`}
                  aria-current={tab === t ? "page" : undefined}
                  className={`rounded-[6px] px-3 py-1 text-sm transition-colors ${
                    tab === t ? "bg-surface-2 text-ink-1" : "text-ink-3 hover:text-ink-1"
                  }`}
                >
                  {LABEL[t]}
                  <kbd className="mono ml-1.5 text-[10px] text-ink-3">{i + 1}</kbd>
                </a>
              ))}
            </nav>
            <WalletButton />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-[1240px] px-5 py-6">{children}</main>
      <footer className="mx-auto max-w-[1240px] px-5 pb-8 pt-6">
        <p className="max-w-[92ch] text-xs leading-relaxed text-ink-3">
          Bids, loan sizes and collateral live on chain as ElGamal ciphertexts. The administrator holds the auditor key
          and reads them to run the market; each print publishes per-tick sums with proofs of correct decryption that
          this page can re-verify. Membership, side, rate and timing are public by design. The simulated members are
          labelled as such. Nothing here is investment advice.
        </p>
      </footer>
    </div>
  );
}

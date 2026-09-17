/** The page frame: brand, live ticker, wallet; a segmented nav with 1–4 shortcuts; the honest footer. */
import { type ReactNode, useEffect, useState } from "react";
import { config } from "../config";
import { devConsole, useConsole, useConsoleOpen } from "../lib/console";
import { TABS, type Tab, useHashRoute } from "../lib/useHashRoute";
import { useLiveEvents } from "../lib/useLive";
import { DevConsole } from "./DevConsole";
import { SettingsSheet } from "./SettingsSheet";
import { Ticker } from "./Ticker";
import { Button } from "./ui";
import { WalletButton } from "./WalletButton";

const LABEL: Record<Tab, string> = {
  market: "Market",
  explorer: "Explorer",
  desk: "Desk",
  positions: "Positions",
  build: "Build",
};

export function Shell({ tab, children }: { tab: Tab; children: ReactNode }) {
  const { go } = useHashRoute();
  const [settings, setSettings] = useState(false);
  const [consoleOpen] = useConsoleOpen();
  const entryCount = useConsole().length;
  useLiveEvents(); // the real-time layer lives as long as the shell
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = (e.target as HTMLElement | null)?.tagName;
      if (t === "INPUT" || t === "SELECT" || t === "TEXTAREA") return;
      if (e.key === "`") {
        e.preventDefault();
        devConsole.toggle();
        return;
      }
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
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center gap-x-4 gap-y-2 px-5 py-2.5 xl:flex-nowrap">
          <a href="#/market" className="flex shrink-0 items-baseline gap-2 whitespace-nowrap">
            <span className="text-[15px] font-semibold tracking-tight text-ink-1">THE WINDOW</span>
            <span className="text-xs text-ink-3">for Stocks</span>
            <span className="mono rounded-[var(--radius-sm)] border border-line px-1.5 text-[10px] uppercase tracking-[0.12em] text-ink-3">
              {config.cluster}
            </span>
          </a>
          <div className="hidden min-w-0 flex-1 overflow-hidden xl:block">
            <Ticker />
          </div>
          <div className="ml-auto flex shrink-0 items-center gap-2">
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
            <Button
              variant="ghost"
              size="sm"
              icon="terminal"
              onClick={() => devConsole.toggle()}
              title="developer console (`)"
              className={consoleOpen ? "border-accent/60 text-accent" : ""}
            >
              <span className="mono text-[11px]">{entryCount}</span>
            </Button>
            <Button variant="ghost" size="sm" icon="gear" onClick={() => setSettings(true)} title="settings">
              <span className="sr-only">settings</span>
            </Button>
          </div>
        </div>
      </header>
      <main className={`mx-auto max-w-[1240px] px-5 py-6 ${consoleOpen ? "pb-[46vh]" : ""}`}>{children}</main>
      <footer className="mx-auto max-w-[1240px] px-5 pb-8 pt-6">
        <p className="max-w-[92ch] text-xs leading-relaxed text-ink-3">
          Bids, loan sizes and collateral live on chain as ElGamal ciphertexts. The administrator holds the auditor key
          and reads them to run the market; each print publishes per-tick sums with proofs of correct decryption that
          this page can re-verify. Membership, side, rate and timing are public by design. The simulated members are
          labelled as such. Nothing here is investment advice.
        </p>
      </footer>
      <DevConsole />
      {settings && <SettingsSheet onClose={() => setSettings(false)} />}
    </div>
  );
}

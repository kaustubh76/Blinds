/** The page frame: brand, nav pills, live status, theme, wallet; a bottom tab bar on phones; the honest footer. */
import { type ReactNode, useEffect, useState } from "react";
import { config } from "../config";
import { devConsole, useConsole, useConsoleOpen } from "../lib/console";
import { useTheme } from "../lib/theme";
import { TABS, type Tab, useHashRoute } from "../lib/useHashRoute";
import { useLiveEvents } from "../lib/useLive";
import { DevConsole } from "./DevConsole";
import { Icon, type IconName } from "./Icon";
import { SettingsSheet } from "./SettingsSheet";
import { StatusPill } from "./Ticker";
import { Button } from "./ui";
import { WalletButton } from "./WalletButton";

const LABEL: Record<Tab, string> = {
  home: "Home",
  desk: "Desk",
  positions: "Positions",
  market: "Market",
  agent: "Agent",
  explorer: "Explorer",
  build: "Build",
};
const ICON: Record<Tab, IconName> = {
  home: "home",
  desk: "zap",
  positions: "layers",
  market: "chart",
  agent: "sparkles",
  explorer: "search",
  build: "code",
};

/** The window-in-a-ring mark. */
export function BrandMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      <defs>
        <linearGradient id="brandmark" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="var(--color-accent)" />
          <stop offset="1" stopColor="#f472b6" />
        </linearGradient>
      </defs>
      <circle
        cx="12"
        cy="12"
        r="9.5"
        fill="none"
        stroke="url(#brandmark)"
        strokeWidth="3"
        strokeLinecap="round"
        strokeDasharray="44 16"
        transform="rotate(-90 12 12)"
      />
      <rect x="8.5" y="8.5" width="7" height="7" rx="1.5" fill="var(--color-ink-1)" />
    </svg>
  );
}

export function Shell({ tab, children }: { tab: Tab; children: ReactNode }) {
  const { go } = useHashRoute();
  const [settings, setSettings] = useState(false);
  const [consoleOpen] = useConsoleOpen();
  const entryCount = useConsole().length;
  const theme = useTheme();
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
      <header className="sticky top-0 z-20 border-b border-line bg-surface-0/85 backdrop-blur">
        <div className="mx-auto flex max-w-[1240px] items-center gap-3 px-4 py-2.5 sm:px-6">
          <a href="#/" className="flex shrink-0 items-center gap-2 whitespace-nowrap">
            <BrandMark />
            <span className="text-[15px] font-semibold tracking-tight text-ink-1">The Window</span>
            <span className="mono hidden rounded-full border border-line px-1.5 text-[10px] uppercase tracking-[0.12em] text-ink-3 sm:inline">
              {config.cluster}
            </span>
          </a>
          <nav
            className="mx-auto hidden rounded-full border border-line bg-surface-1 p-0.5 md:flex"
            aria-label="Sections"
          >
            {TABS.map((t, i) => (
              <a
                key={t}
                href={`#/${t}`}
                aria-current={tab === t ? "page" : undefined}
                className={`rounded-full px-3.5 py-1.5 text-sm transition-colors ${
                  tab === t ? "bg-ink-1 text-surface-1" : "text-ink-2 hover:text-ink-1"
                }`}
                title={`${LABEL[t]} (${i + 1})`}
              >
                {LABEL[t]}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex shrink-0 items-center gap-2">
            <div className="hidden lg:block">
              <StatusPill />
            </div>
            <WalletButton />
            <Button
              variant="ghost"
              size="sm"
              icon={theme.resolved === "dark" ? "sun" : "moon"}
              onClick={theme.toggle}
              title={theme.resolved === "dark" ? "light theme" : "dark theme"}
            >
              <span className="sr-only">theme</span>
            </Button>
            <Button
              variant="ghost"
              size="sm"
              icon="terminal"
              onClick={() => devConsole.toggle()}
              title="developer console (`)"
              className={`hidden sm:inline-flex ${consoleOpen ? "border-accent/60 text-accent" : ""}`}
            >
              <span className="mono text-[11px]">{entryCount}</span>
            </Button>
            <Button variant="ghost" size="sm" icon="gear" onClick={() => setSettings(true)} title="settings">
              <span className="sr-only">settings</span>
            </Button>
          </div>
        </div>
      </header>
      <main className={`mx-auto max-w-[1240px] px-4 py-6 pb-24 sm:px-6 md:pb-8 ${consoleOpen ? "md:pb-[46vh]" : ""}`}>
        {children}
      </main>
      <footer className="mx-auto max-w-[1240px] px-4 pb-24 pt-6 sm:px-6 md:pb-10">
        <div className="flex flex-wrap items-start justify-between gap-6 border-t border-line pt-6">
          <div className="flex items-center gap-2 text-sm text-ink-2">
            <BrandMark size={18} />
            The Window for Stocks · devnet
          </div>
          <p className="max-w-[72ch] text-xs leading-relaxed text-ink-3">
            Bids, loan sizes and collateral live on chain as ElGamal ciphertexts. The administrator holds the auditor
            key and reads them to run the market; each print publishes per-tick sums with proofs of correct decryption
            that this site can re-verify. Membership, side, rate and timing are public by design. The simulated members
            are labelled as such. Nothing here is investment advice.
          </p>
        </div>
      </footer>
      {/* Phones: a bottom tab bar instead of the pill nav. */}
      <nav
        className="fixed inset-x-0 bottom-0 z-20 flex border-t border-line bg-surface-1/95 backdrop-blur md:hidden"
        aria-label="Sections"
      >
        {TABS.filter((t) => t !== "build").map((t) => (
          <a
            key={t}
            href={`#/${t}`}
            aria-current={tab === t ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${
              tab === t ? "text-accent" : "text-ink-3"
            }`}
          >
            <Icon name={ICON[t]} size={18} />
            {LABEL[t]}
          </a>
        ))}
      </nav>
      <DevConsole />
      {settings && <SettingsSheet onClose={() => setSettings(false)} />}
    </div>
  );
}

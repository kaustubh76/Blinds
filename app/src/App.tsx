import { useState } from "react";
import { WalletButton } from "./components/WalletButton";
import { config } from "./config";
import { Desk } from "./features/desk/Desk";
import { Explorer } from "./features/explorer/Explorer";
import { Home } from "./features/home/Home";
import { Positions } from "./features/positions/Positions";
import { useDeployment } from "./lib/queries";

const TABS = ["Market", "Explorer", "Desk", "Positions"] as const;
type Tab = (typeof TABS)[number];

export function App() {
  const [tab, setTab] = useState<Tab>("Market");
  const dep = useDeployment();
  return (
    <div className="mx-auto max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">THE WINDOW for Stocks</h1>
          <p className="text-xs text-mute">
            A private margin desk for tokenized stocks on Solana · {config.cluster}
            {dep.data ? ` · ${dep.data.raw.profile} profile` : ""}
          </p>
        </div>
        <nav className="flex gap-1 rounded border border-line p-1">
          {TABS.map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setTab(t)}
              className={`rounded px-3 py-1 text-sm ${tab === t ? "bg-line text-fg" : "text-mute hover:text-fg"}`}
            >
              {t}
            </button>
          ))}
        </nav>
        <WalletButton />
      </header>
      <main>
        {tab === "Market" && <Home />}
        {tab === "Explorer" && <Explorer />}
        {tab === "Desk" && <Desk />}
        {tab === "Positions" && <Positions />}
      </main>
      <footer className="mt-10 border-t border-line pt-4 text-xs text-mute">
        Bids, loan sizes and collateral are ElGamal ciphertexts on-chain. The administrator holds the auditor key and
        reads them to run the market; per-tick sums are published with proofs of correct decryption and can be
        re-verified in this browser. Membership, side, rate and timing are public by design. Simulated members are
        labelled as such by the admin service.
      </footer>
    </div>
  );
}

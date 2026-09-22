import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import * as sdk from "@thewindow/solana-sdk";
import { isTransientRpcError } from "@thewindow/solana-sdk";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorScreen } from "./components/ErrorScreen";
import "./index.css";
import { config } from "./config";
import { registerBurnerWallet } from "./lib/burner";
import { rpc } from "./lib/chain";
import { devConsole } from "./lib/console";
import { SessionProvider, WalletBridges } from "./lib/wallet";

// A public RPC answers 429 and drops connections; those are retried with backoff, wrong queries are not.
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (n, e) => n < 4 && isTransientRpcError(e),
      retryDelay: (n) => Math.min(1_000 * 2 ** n, 15_000) + Math.random() * 400,
      refetchOnWindowFocus: false,
      refetchIntervalInBackground: false,
    },
  },
});

// Registered before the first render so `useWallets` sees it in its first snapshot. A wallet
// extension that injects a broken registry must not take the read-only dashboard down with it.
try {
  registerBurnerWallet();
} catch (e) {
  console.error("burner wallet unavailable in this browser", e);
}

// The whole SDK on the page, for DevTools: `await thewindow.sdk.fetchAuctionConfig(thewindow.rpc)`.
window.thewindow = {
  sdk,
  rpc,
  config,
  console: devConsole,
  queryClient,
  // The collateral schedule as the chain would judge it now (the Build page's "schedule" recipe).
  schedule: () => runRecipe("schedule"),
  // The lender agent's DBC pool, decoded from raw bytes (the Build page's "launch-status" recipe).
  launch: () => runRecipe("launch-status"),
};

async function runRecipe(id: string) {
  {
    const { RECIPES } = await import("./features/build/recipes");
    const r = RECIPES.find((x) => x.id === id);
    if (!r) throw new Error(`${id} recipe missing`);
    return r.run({
      sdk,
      rpc,
      config,
      deployment: null,
      wallet: null,
      memberSignature: null,
      rentFor: async () => 0n,
      signal: new AbortController().signal,
      log: (line) => devConsole.push({ kind: "note", title: line }),
    });
  }
}

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <ErrorScreen>
      <QueryClientProvider client={queryClient}>
        <SessionProvider>
          <WalletBridges />
          <App />
        </SessionProvider>
      </QueryClientProvider>
    </ErrorScreen>
  </StrictMode>,
);

// React mounted: the static fallback in index.html has served its purpose.
document.getElementById("boot-fallback")?.remove();

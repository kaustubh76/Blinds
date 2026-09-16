import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isTransientRpcError } from "@thewindow/solana-sdk";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";
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

const root = document.getElementById("root");
if (!root) throw new Error("#root missing");
createRoot(root).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <WalletBridges />
        <App />
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>,
);

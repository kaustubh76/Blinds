/// <reference types="vite/client" />
interface ImportMetaEnv {
  readonly VITE_RPC_URL?: string;
  readonly VITE_ADMIN_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_CLUSTER?: string;
  /** Browser-friendly mainnet RPC for reading Pyth's accounts (the public one answers 403 to browsers). */
  readonly VITE_MAINNET_RPC_URL?: string;
}

interface Window {
  /** The SDK, RPC client, config, console store and query client — for DevTools and integrations. */
  thewindow: {
    sdk: typeof import("@thewindow/solana-sdk");
    rpc: import("./lib/chain").Rpc;
    config: import("./config").Resolved;
    console: typeof import("./lib/console").devConsole;
    queryClient: import("@tanstack/react-query").QueryClient;
    /** Every listing with its mark, both freshness verdicts and PDAs — `await thewindow.schedule()`. */
    schedule: () => Promise<unknown>;
  };
}

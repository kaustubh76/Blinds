/**
 * Build-time configuration. `VITE_*` values come from `.env` (see `.env.example`).
 *
 * A production build with nothing set is a hosted build: it points at the devnet deployment,
 * not at a localhost validator that does not exist where it is served. A dev build with nothing
 * set is a local one.
 */
const hosted = import.meta.env.PROD;

export const config = {
  rpcUrl: import.meta.env.VITE_RPC_URL ?? (hosted ? "https://api.devnet.solana.com" : "http://127.0.0.1:8899"),
  adminUrl: import.meta.env.VITE_ADMIN_URL ?? (hosted ? "" : "http://127.0.0.1:9090"),
  cluster: (import.meta.env.VITE_CLUSTER ?? (hosted ? "devnet" : "localnet")) as "localnet" | "devnet",
} as const;

/** Wallet-standard chain identifier for the configured cluster. */
export const chain: `solana:${string}` = config.cluster === "devnet" ? "solana:devnet" : "solana:localnet";

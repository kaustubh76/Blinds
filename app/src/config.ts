/** Build-time configuration. `VITE_*` values come from `.env` (see `.env.example`). */
export const config = {
  rpcUrl: import.meta.env.VITE_RPC_URL ?? "http://127.0.0.1:8899",
  adminUrl: import.meta.env.VITE_ADMIN_URL ?? "http://127.0.0.1:9090",
  cluster: (import.meta.env.VITE_CLUSTER ?? "localnet") as "localnet" | "devnet",
} as const;

/** Wallet-standard chain identifier for the configured cluster. */
export const chain: `solana:${string}` = config.cluster === "devnet" ? "solana:devnet" : "solana:localnet";

# Dashboard

Vite 8 + React 19 + Tailwind 4, wallet-standard through `@solana/react`. It reads the chain directly
with `@thewindow/solana-sdk` and generates its proofs in the browser with the `window-proofs` wasm —
the wallet signature that derives a member's ElGamal keys never leaves the tab.

```bash
cp .env.example .env     # VITE_RPC_URL, VITE_ADMIN_URL, VITE_CLUSTER
pnpm dev                 # http://localhost:5173
```

## Deploying it

The app is a static SPA; `vercel.json` has the build for a monorepo checkout. Two prerequisites:

1. **`sdk/wasm` must exist in the checkout.** It is produced by `./scripts/build_wasm.sh` (needs the
   Rust toolchain and `wasm-pack`) and is git-ignored by default, so either run that in the build or
   commit the four files under `sdk/wasm/` before pushing.
2. **Set the environment variables** in the hosting project: `VITE_CLUSTER=devnet`,
   `VITE_RPC_URL=<an RPC that tolerates browser traffic>` and, if the demo faucet should work,
   `VITE_ADMIN_URL=<public URL of the admin service>`.

`api.devnet.solana.com` rate-limits browsers hard; a free dedicated RPC endpoint is worth it for a
public deployment.

## Without the admin service

`deployments/devnet.json` is bundled at build time, so Market, Explorer and Positions work from the
chain alone. Only the Desk's *Join* button (the demo faucet that registers a member and mints mock
shares) needs `VITE_ADMIN_URL` to be reachable; the UI says so when it is not.

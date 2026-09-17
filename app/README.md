# Dashboard

Vite 8 + React 19 + Tailwind 4, wallet-standard through `@solana/react`. It reads the chain directly
with `@thewindow/solana-sdk` and generates its proofs in the browser with the `window-proofs` wasm —
the wallet signature that derives a member's ElGamal keys never leaves the tab.

```bash
cp .env.example .env     # VITE_RPC_URL, VITE_ADMIN_URL, VITE_CLUSTER
pnpm dev                 # http://localhost:5173
```

## Deploying it

The app is a static SPA; `vercel.json` carries the monorepo build (root directory `app`; the SDK is
built first with `pnpm --filter`; `--prod=false` keeps the dev dependencies the build needs under
Vercel's `NODE_ENV=production`). `sdk/wasm` — the browser proof engine — is committed, so no Rust
toolchain is needed. The exact Vercel steps are in the root `README.md` under "Hosting".

Environment variables: `VITE_CLUSTER=devnet`, `VITE_RPC_URL=<an RPC that tolerates browser traffic>`
and, only if the demo faucet should work, `VITE_ADMIN_URL=<public URL of the admin service>`.

`api.devnet.solana.com` rate-limits browsers hard; a free dedicated RPC endpoint is worth it for a
public deployment.

## Without the admin service

`deployments/devnet.json` is bundled at build time, so Market, Explorer and Positions work from the
chain alone. Only the Desk's *Join* button (the demo faucet that registers a member and mints mock
shares) needs `VITE_ADMIN_URL` to be reachable; the UI says so when it is not.

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

## Runtime settings, burner, console, Build

A production build reads its endpoints at load: `?rpc=` `?ws=` `?admin=` on the URL (persisted to
the browser and stripped from the address bar) > the Settings sheet (gear) > `VITE_*` > hosted
defaults (devnet, no admin service). On hosted builds `admin-url.txt` next to the page (copied
from `deployments/admin-url.txt` by the Pages workflow) is the fallback pointer to the faucet.

- `src/lib/burner.ts` — a devnet keypair in localStorage registered as a Wallet Standard wallet
  (`standard:connect/disconnect/events`, `solana:signTransaction`, `solana:signMessage`), so
  `@solana/react`'s signer hooks work unchanged; devnet/localnet only.
- `src/lib/console.ts` + `components/DevConsole.tsx` — the developer console; `src/lib/send.ts`
  is the choke point that logs every plan and transaction; `src/lib/asCode.ts` renders calls as
  code and redacts secrets by key before rendering.
- `src/lib/live.ts` + `useLive.ts` — WebSocket account + logs subscriptions, Anchor events decoded
  with the generated codecs, backoff; polling stays the source of truth.
- `src/features/build/` — the Build page: `Schedule.tsx` (the collateral schedule as a developer reads
  it: every listing's PDA, price-cache PDA and feed id, source, mark, haircut, and the verdict the chain
  would give a lock or seize right now — `fetchListings` → `fetchPrices` → `quoteFreshness`, with the
  code shown), `Tracks.tsx` (Pyth / Tessera / PreStocks: what to call, the public-API `curl`, Pyth's
  mainnet accounts read from the browser, each track's honest limit), `recipes.ts` (code + run side by
  side, coupled by a test: `config`, `schedule`, `pyth-mainnet`, `marks`, `solvency`, `print`,
  `verify-print`, `membership`, `bid-dry-run`, `subscribe`), `ProgramSurface.tsx` (from `sdk/idl/*.json`).
  The mark APIs (Tessera, PreStocks) send no CORS headers, so the browser reads marks from the on-chain
  `PriceCache` and shows the `curl`.
- `window.thewindow` — the SDK, RPC, config, console and query client for DevTools;
  `await thewindow.schedule()` returns the schedule rows the `schedule` recipe prints.

## Without the admin service

`deployments/devnet.json` is bundled at build time, so Market, Explorer and Positions work from the
chain alone. Only the Desk's *Join* button (the demo faucet that registers a member and mints mock
shares) needs an admin URL that is reachable (`?admin=`, Settings, `VITE_ADMIN_URL`, or the hosted
pointer); the UI says so when it is not, and a wallet that is already a member can still trade.

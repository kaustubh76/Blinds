#!/usr/bin/env bash
# Builds the dashboard exactly as the Pages workflow does (no Rust: sdk/wasm is committed) and
# publishes app/dist to Vercel as a static site — a second public host beside GitHub Pages, at the
# site root (hash routes, so no rewrites). Needs `vercel login` once and the project link in
# app/.vercel (`cd app && vercel link --project the-window-for-stocks`), which is copied into dist.
#
#   ./scripts/deploy_vercel.sh            # production deploy, prints the URL
#   ./scripts/deploy_vercel.sh preview    # a preview deployment instead
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="$HOME/Library/pnpm:$PATH"
pnpm --filter @thewindow/solana-sdk build >/dev/null
VITE_BASE=/ VITE_CLUSTER=devnet \
  VITE_RPC_URL="${VITE_RPC_URL:-https://api.devnet.solana.com}" \
  VITE_MAINNET_RPC_URL="${VITE_MAINNET_RPC_URL:-https://solana-rpc.publicnode.com}" \
  pnpm --filter @thewindow/app build >/dev/null
# The faucet pointer the hosted app reads at runtime (see deployments/admin-url.txt).
cp deployments/admin-url.txt app/dist/admin-url.txt
[ -d app/.vercel ] || { echo "link the project first: cd app && vercel link --project the-window-for-stocks"; exit 1; }
cp -R app/.vercel app/dist/.vercel
cd app/dist
args=(deploy --yes)
[ "${1:-prod}" = prod ] && args+=(--prod)
vercel "${args[@]}"

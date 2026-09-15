#!/usr/bin/env bash
# Runs a real Agave validator with the five programs preloaded and drives either the tier-2
# integration suite or the demo against it. Usage: WINDOW_PROFILE=<profile> ./scripts/localnet.sh {test|demo|up}
set -euo pipefail
cd "$(dirname "$0")/.."
MODE="${1:-up}"
PROFILE="${WINDOW_PROFILE:-demo}"
export WINDOW_RPC_URL="${WINDOW_RPC_URL:-http://127.0.0.1:8899}"
LEDGER="test-ledger"
PROGRAMS=(window_registry window_auction window_oracle window_wrap window_credit)

for p in "${PROGRAMS[@]}"; do
  [ -f "target/deploy/$p.so" ] || { echo "localnet: target/deploy/$p.so missing — run make build"; exit 1; }
done

args=(--reset --quiet --ledger "$LEDGER" --rpc-port 8899)
for p in "${PROGRAMS[@]}"; do
  args+=(--bpf-program "$(solana-keygen pubkey deployments/program-keypairs/$p-keypair.json)" "target/deploy/$p.so")
done

cleanup() { [ -n "${VALIDATOR_PID:-}" ] && kill "$VALIDATOR_PID" 2>/dev/null || true; [ -n "${ADMIN_PID:-}" ] && kill "$ADMIN_PID" 2>/dev/null || true; }
trap cleanup EXIT

solana-test-validator "${args[@]}" >"$LEDGER.log" 2>&1 &
VALIDATOR_PID=$!
for _ in $(seq 1 60); do solana cluster-version -u "$WINDOW_RPC_URL" >/dev/null 2>&1 && break; sleep 1; done
./scripts/check_localnet.sh

pnpm tsx scripts/setup_localnet.ts --profile "$PROFILE"          # mints, configs, members, escrow -> deployments/localnet.json

case "$MODE" in
  up)
    echo "localnet: up with profile $PROFILE (ctrl-c to stop)"; wait "$VALIDATOR_PID" ;;
  test)
    WINDOW_PROFILE="$PROFILE" pnpm --filter @thewindow/integration test ;;
  demo)
    WINDOW_PROFILE="$PROFILE" cargo run -p window-admin --release -- run --cluster localnet >admin.log 2>&1 &
    ADMIN_PID=$!
    WINDOW_PROFILE="$PROFILE" pnpm --filter @thewindow/agents start -- --epochs 1 &
    pnpm tsx scripts/watch_epoch.ts --epochs 1 --timeout 360 ;;
  *) echo "usage: localnet.sh {up|test|demo}"; exit 2 ;;
esac

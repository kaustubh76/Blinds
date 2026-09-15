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

[ -f deployments/external/spl_token_2022.so ] || ./scripts/fetch_external_programs.sh
args=(--reset --quiet --ledger "$LEDGER" --rpc-port 8899)
# the deployed Token-2022 (zk-ops) and ATA programs, identical to devnet
args+=(--bpf-program TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb deployments/external/spl_token_2022.so)
args+=(--bpf-program ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL deployments/external/spl_associated_token_account.so)
# program ids: the fixed ones in Anchor.toml (the keypairs themselves are only needed to deploy to devnet)
program_id() { grep -E "^$1 = " Anchor.toml | head -1 | sed -E 's/.*"([^"]+)".*/\1/'; }
for p in "${PROGRAMS[@]}"; do
  args+=(--bpf-program "$(program_id "$p")" "target/deploy/$p.so")
done

cleanup() { for v in VALIDATOR_PID ADMIN_PID AGENTS_PID; do [ -n "${!v:-}" ] && kill "${!v}" 2>/dev/null || true; done; }
trap cleanup EXIT

solana-test-validator "${args[@]}" >"$LEDGER.log" 2>&1 &
VALIDATOR_PID=$!
for _ in $(seq 1 60); do solana cluster-version -u "$WINDOW_RPC_URL" >/dev/null 2>&1 && break; sleep 1; done
./scripts/check_localnet.sh

export WINDOW_AUDITOR_SEED_HEX="${WINDOW_AUDITOR_SEED_HEX:-1111111111111111111111111111111111111111111111111111111111111111}"
cargo run -q -p window-admin --release -- --cluster localnet --profile "$PROFILE" setup --agents "${WINDOW_AGENTS:-6}"

case "$MODE" in
  up)
    echo "localnet: up with profile $PROFILE (ctrl-c to stop)"; wait "$VALIDATOR_PID" ;;
  test)
    WINDOW_PROFILE="$PROFILE" pnpm --filter @thewindow/integration test ;;
  demo)
    cargo run -q -p window-admin --release -- --cluster localnet --profile "$PROFILE" run --max-prints "${WINDOW_DEMO_PRINTS:-2}" >admin.log 2>&1 &
    ADMIN_PID=$!
    cargo run -q -p window-admin --release -- --cluster localnet --profile "$PROFILE" agents >agents.log 2>&1 &
    AGENTS_PID=$!
    wait "$ADMIN_PID"; kill "$AGENTS_PID" 2>/dev/null || true
    grep -E "printed|matches posted|collateral" admin.log agents.log | tail -20 ;;
  *) echo "usage: localnet.sh {up|test|demo}"; exit 2 ;;
esac

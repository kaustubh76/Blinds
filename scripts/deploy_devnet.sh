#!/usr/bin/env bash
# Deploys the five programs to devnet with the fixed program keypairs and initialises state.
# Needs ~10 SOL on the deployer (`solana balance -ud`): 1.37 MB of program data at devnet rent.
# Usage: ./scripts/deploy_devnet.sh [--skip-programs]
set -euo pipefail
cd "$(dirname "$0")/.."
export WINDOW_CLUSTER=devnet
PROFILE="${WINDOW_PROFILE:-demo}"
: "${WINDOW_AUDITOR_SEED_HEX:?set WINDOW_AUDITOR_SEED_HEX (32-byte hex; keep it — it is the auditor key)}"
PROGRAMS=(window_registry window_auction window_oracle window_wrap window_credit)

for p in "${PROGRAMS[@]}"; do
  [ -f "deployments/program-keypairs/$p-keypair.json" ] || { echo "missing deployments/program-keypairs/$p-keypair.json"; exit 1; }
  cp "deployments/program-keypairs/$p-keypair.json" "target/deploy/$p-keypair.json"
done

solana feature status zkhiy5oLowR7HY4zogXjCjeMXyruLqBwSWH21qcFtnv -ud | grep -q active || { echo "ZK ElGamal proof program feature not active on devnet"; exit 1; }

if [ "${1:-}" != "--skip-programs" ]; then
  echo "deployer: $(solana address) balance: $(solana balance -ud)"
  for p in "${PROGRAMS[@]}"; do
    id="$(solana-keygen pubkey "deployments/program-keypairs/$p-keypair.json")"
    if solana program show "$id" -ud >/dev/null 2>&1; then
      echo "$p already deployed at $id — upgrading"
    fi
    solana program deploy "target/deploy/$p.so" --program-id "deployments/program-keypairs/$p-keypair.json" -ud --with-compute-unit-price 1000 --max-sign-attempts 30
  done
fi

cargo run -q -p window-admin --release -- --cluster devnet --profile "$PROFILE" setup --agents "${WINDOW_AGENTS:-6}" --airdrop=false
echo "deployments/devnet.json written. Run the market with:"
echo "  WINDOW_CLUSTER=devnet WINDOW_PROFILE=$PROFILE ./target/release/window-admin run &"
echo "  WINDOW_CLUSTER=devnet WINDOW_PROFILE=$PROFILE ./target/release/window-admin agents &"

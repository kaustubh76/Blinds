#!/usr/bin/env bash
# Deploys the five programs to devnet at their fixed ids and initialises the market.
#
# `programdata` is sized at the FIRST deploy and can never shrink, so the binaries must already be
# the ones you intend to freeze (`make build` with the size profile in the workspace Cargo.toml).
# The only growth path afterwards is `solana program extend`; never run `solana program close` on
# one of these programs — it refunds the rent but burns the program id forever.
#
# Safe to re-run: already-deployed programs are skipped and orphaned buffers are recovered.
# Usage: WINDOW_AUDITOR_SEED_HEX=<64 hex> ./scripts/deploy_devnet.sh [--skip-programs]
set -euo pipefail
cd "$(dirname "$0")/.."
export WINDOW_CLUSTER=devnet
PROFILE="${WINDOW_PROFILE:-devnet}"
AGENTS="${WINDOW_AGENTS:-4}"
: "${WINDOW_AUDITOR_SEED_HEX:?set WINDOW_AUDITOR_SEED_HEX (64 hex chars) — it IS the auditor key; save it}"
[ "${#WINDOW_AUDITOR_SEED_HEX}" -eq 64 ] || { echo "WINDOW_AUDITOR_SEED_HEX must be 64 hex chars"; exit 1; }

# Cheapest first: if the balance runs out, the least is stranded.
PROGRAMS=(window_registry window_wrap window_oracle window_auction window_credit)
sol() { python3 -c "print(f'{$1/1e9:.4f}')"; }

echo "── preflight ─────────────────────────────────────────────────────────"
solana feature status zkhiy5oLowR7HY4zogXjCjeMXyruLqBwSWH21qcFtnv -ud | grep -q active \
  || { echo "ZK ElGamal Proof program feature is not active on devnet"; exit 1; }
echo "ZK ElGamal Proof program: active"

need=0
for p in "${PROGRAMS[@]}"; do
  kp="deployments/program-keypairs/$p-keypair.json"
  [ -f "$kp" ] || { echo "missing $kp"; exit 1; }
  [ -f "target/deploy/$p.so" ] || { echo "missing target/deploy/$p.so — run make build"; exit 1; }
  id="$(solana-keygen pubkey "$kp")"
  want="$(grep -E "^$p = " Anchor.toml | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
  [ "$id" = "$want" ] || { echo "$p keypair is $id but Anchor.toml says $want"; exit 1; }
  size=$(stat -f%z "target/deploy/$p.so" 2>/dev/null || stat -c%s "target/deploy/$p.so")
  if solana program show "$id" -ud >/dev/null 2>&1; then
    printf "  %-17s %8d B  already deployed at %s\n" "$p" "$size" "$id"
  else
    rent=$(solana rent $((size + 45)) -ud | awk '{print $3}')
    lamports=$(python3 -c "print(int(round($rent*1e9)))")
    need=$((need + lamports + 833120))   # + the 36-byte program account
    printf "  %-17s %8d B  %s SOL  -> %s\n" "$p" "$size" "$rent" "$id"
  fi
done

balance=$(solana balance -ud | awk '{print $1}')
have=$(python3 -c "print(int(round($balance*1e9)))")
# Deploy write transactions and the setup that follows both cost fees; keep a margin.
margin=50000000
echo "  ---"
echo "  need $(sol $((need + margin))) SOL (rent + fees)   have $balance SOL"
[ "$have" -ge $((need + margin)) ] || { echo "insufficient balance on $(solana address)"; exit 1; }

cleanup_buffers() {
  local buffers
  buffers=$(solana program show --buffers -ud 2>/dev/null | tail -n +2 | awk '{print $1}')
  if [ -n "$buffers" ]; then
    echo "recovering rent from orphaned buffers:"; echo "$buffers"
    solana program close --buffers -ud || true
  fi
}
trap 'echo; echo "deploy interrupted — recovering buffers so the rent is not stranded"; cleanup_buffers' ERR

if [ "${1:-}" != "--skip-programs" ]; then
  echo
  echo "── deploy ────────────────────────────────────────────────────────────"
  cleanup_buffers
  for p in "${PROGRAMS[@]}"; do
    kp="deployments/program-keypairs/$p-keypair.json"
    id="$(solana-keygen pubkey "$kp")"
    if solana program show "$id" -ud >/dev/null 2>&1; then
      echo "  $p already at $id — skipping (use \`solana program deploy\` directly to upgrade)"
      continue
    fi
    before=$(solana balance -ud | awk '{print $1}')
    cp "$kp" "target/deploy/$p-keypair.json"
    solana program deploy "target/deploy/$p.so" --program-id "$kp" -ud \
      --with-compute-unit-price 1000 --max-sign-attempts 60
    after=$(solana balance -ud | awk '{print $1}')
    echo "  $p deployed: $id   cost $(python3 -c "print(f'{$before-$after:.4f}')") SOL   left $after SOL"
  done
fi
trap - ERR

echo
echo "── setup ─────────────────────────────────────────────────────────────"
cargo run -q -p window-admin --release -- --cluster devnet --profile "$PROFILE" \
  setup --agents "$AGENTS" --airdrop=false

echo
echo "deployments/devnet.json written. Balance: $(solana balance -ud)"
echo "Run the market:"
echo "  WINDOW_CLUSTER=devnet WINDOW_PROFILE=$PROFILE ./target/release/window-admin run &"
echo "  WINDOW_CLUSTER=devnet WINDOW_PROFILE=$PROFILE ./target/release/window-admin agents &"
echo "Then verify a print end to end:"
echo "  WINDOW_RPC_URL=https://api.devnet.solana.com pnpm tsx scripts/watch_epoch.ts --epochs 2"

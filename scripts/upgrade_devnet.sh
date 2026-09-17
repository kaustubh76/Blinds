#!/usr/bin/env bash
# Upgrades `window_credit` on devnet to the collateral-schedule build and brings the deployment up
# to the profile's listings — without redeploying anything else and without touching the frozen
# Config accounts:
#
#   1. preflight: the market must be stopped; the wallet must hold the upgrade authority and enough
#      SOL for the write buffer (refunded) plus any `programdata` extension (permanent);
#   2. `solana program extend` if the new .so no longer fits the programdata allocated at the first
#      deploy (rent for the extra bytes, ~5,081 lamports/B on devnet);
#   3. `solana program deploy` with the fixed program id (an upgrade when the id already exists);
#   4. `window-admin listings-sync`: listing #0 from Config's own mints/escrow/feed id, so its price
#      cache keeps its history; the other profile listings are created (mints, vaults, escrows);
#   5. `window-admin migrate-loans`: every pre-listing Loan is resized and bound to listing #0.
#
# Re-runnable: each step skips what is already done. Never run scripts/freeze.sh before this.
# Usage: ./scripts/upgrade_devnet.sh            (reads .env for the auditor seed)
set -euo pipefail
cd "$(dirname "$0")/.."
export WINDOW_CLUSTER=devnet
PROFILE="${WINDOW_PROFILE:-devnet}"
[ -f .env ] && { set -a; . ./.env; set +a; }
: "${WINDOW_AUDITOR_SEED_HEX:?set WINDOW_AUDITOR_SEED_HEX — the same seed the deployment was set up with}"
P=window_credit
KP="deployments/program-keypairs/$P-keypair.json"
ID="$(solana-keygen pubkey "$KP")"
SO="target/deploy/$P.so"
sol() { python3 -c "print(f'{$1/1e9:.4f}')"; }

echo "── preflight ─────────────────────────────────────────────────────────"
pgrep -f "window-admin --cluster devnet" >/dev/null && { echo "stop the market first: ./scripts/market.sh stop"; exit 1; }
[ -f "$SO" ] || { echo "missing $SO — run make build"; exit 1; }
want="$(grep -E "^$P = " Anchor.toml | head -1 | sed -E 's/.*"([^"]+)".*/\1/')"
[ "$ID" = "$want" ] || { echo "$P keypair is $ID but Anchor.toml says $want"; exit 1; }
show="$(solana program show "$ID" -ud)"
echo "$show"
authority="$(echo "$show" | awk '/Authority/ {print $2}')"
[ "$authority" = "$(solana address)" ] || { echo "upgrade authority is $authority, not this wallet"; exit 1; }
capacity="$(echo "$show" | awk '/Data Length/ {print $3}')"   # bytes of programdata (incl. 45-byte header)
capacity=$((capacity - 45))
size=$(stat -f%z "$SO" 2>/dev/null || stat -c%s "$SO")
extra=0
if [ "$size" -gt "$capacity" ]; then extra=$((size - capacity + 4096)); fi   # 4 KiB of slack
buffer_rent=$(python3 -c "print(int(round($(solana rent $((size + 45)) -ud | awk '{print $3}')*1e9)))")
extend_rent=0
[ "$extra" -gt 0 ] && extend_rent=$(python3 -c "print(int(round($(solana rent $extra -ud | awk '{print $3}')*1e9)))")
balance=$(solana balance -ud | awk '{print $1}')
have=$(python3 -c "print(int(round($balance*1e9)))")
need=$((buffer_rent + extend_rent + 150000000))   # + fees, listing accounts, loan migrations
printf "  .so %d B   programdata capacity %d B   extend by %d B (%s SOL, permanent)\n" "$size" "$capacity" "$extra" "$(sol $extend_rent)"
printf "  write buffer %s SOL (refunded)   need ~%s SOL   have %s SOL\n" "$(sol $buffer_rent)" "$(sol $need)" "$balance"
[ "$have" -ge "$need" ] || { echo "insufficient balance on $(solana address)"; exit 1; }

cleanup_buffers() {
  local buffers
  buffers=$(solana program show --buffers -ud 2>/dev/null | tail -n +2 | awk '{print $1}')
  if [ -n "$buffers" ]; then
    echo "recovering rent from orphaned buffers:"; echo "$buffers"
    solana program close --buffers -ud || true
  fi
}
trap 'echo; echo "upgrade interrupted — recovering buffers so the rent is not stranded"; cleanup_buffers' ERR

echo
echo "── programdata ───────────────────────────────────────────────────────"
if [ "$extra" -gt 0 ]; then
  solana program extend "$ID" "$extra" -ud
else
  echo "  fits; no extension"
fi

echo
echo "── upgrade ───────────────────────────────────────────────────────────"
cleanup_buffers
before=$(solana balance -ud | awk '{print $1}')
cp "$KP" "target/deploy/$P-keypair.json"
solana program deploy "$SO" --program-id "$KP" -ud --with-compute-unit-price 1000 --max-sign-attempts 60
after=$(solana balance -ud | awk '{print $1}')
echo "  $P upgraded at $ID   cost $(python3 -c "print(f'{$before-$after:.4f}')") SOL   left $after SOL"
trap - ERR

echo
echo "── listings ──────────────────────────────────────────────────────────"
cargo run -q -p window-admin --release -- --cluster devnet --profile "$PROFILE" listings-sync

echo
echo "── loans ─────────────────────────────────────────────────────────────"
cargo run -q -p window-admin --release -- --cluster devnet --profile "$PROFILE" migrate-loans

echo
solana program show "$ID" -ud | grep -E "Program Id|Last Deployed|Data Length"
echo "deployments/devnet.json updated — commit it. Balance: $(solana balance -ud)"
echo "Then: ./scripts/market.sh start"

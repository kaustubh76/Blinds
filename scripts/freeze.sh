#!/usr/bin/env bash
# Irreversibly sets the upgrade authority of every devnet program to None (submission freeze).
set -euo pipefail
cd "$(dirname "$0")/.."
for p in window_registry window_auction window_oracle window_wrap window_credit; do
  id="$(solana-keygen pubkey "deployments/program-keypairs/$p-keypair.json")"
  solana program set-upgrade-authority "$id" --final -ud
  solana program show "$id" -ud | grep -E "Program Id|Authority"
done

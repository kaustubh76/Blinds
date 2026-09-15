#!/usr/bin/env bash
# Fetches the *deployed* Token-2022 program from devnet for tier-1 tests and the local validator.
# LiteSVM's bundled Token-2022 is built without the `zk-ops` feature (confidential transfers
# return InvalidInstructionData); the real program has it. The dump is git-ignored; the checksum
# of the version the suite was verified against is committed next to it.
set -euo pipefail
cd "$(dirname "$0")/.."
mkdir -p deployments/external
solana program dump TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb deployments/external/spl_token_2022.so -u "${1:-devnet}"
echo "fetched: $(shasum -a 256 deployments/external/spl_token_2022.so | cut -c1-16)…  (verified: $(cut -c1-16 deployments/external/spl_token_2022.sha256))"

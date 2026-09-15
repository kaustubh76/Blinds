#!/usr/bin/env bash
# Asserts a local validator is reachable and has what THE WINDOW needs:
# the ZK ElGamal Proof program (SIMD-0153) enabled, curve25519 syscalls, and Token-2022 executable.
set -euo pipefail
URL="${WINDOW_RPC_URL:-http://127.0.0.1:8899}"
ZK_FEATURE=zkhiy5oLowR7HY4zogXjCjeMXyruLqBwSWH21qcFtnv
CURVE_FEATURE=7rcw5UtqgDTBBv2EcynNfYckgdAaH1MAsCjKgXMkN7Ri
ZK_PROGRAM=ZkE1Gama1Proof11111111111111111111111111111
TOKEN_2022=TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb

solana cluster-version -u "$URL" >/dev/null || { echo "no validator at $URL"; exit 1; }
for f in $ZK_FEATURE $CURVE_FEATURE; do
  solana feature status "$f" -u "$URL" | grep -q "active" || { echo "feature $f not active"; exit 1; }
done
for p in $ZK_PROGRAM $TOKEN_2022; do
  solana account "$p" -u "$URL" | grep -q "Executable: true" || { echo "program $p not executable"; exit 1; }
done
echo "check_localnet: ok ($URL)"

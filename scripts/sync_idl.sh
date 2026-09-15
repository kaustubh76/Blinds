#!/usr/bin/env bash
# Freezes the Anchor IDLs into sdk/idl/ so the TypeScript clients are generated from a reviewed,
# committed artefact rather than from whatever the last local build produced.
#   ./scripts/sync_idl.sh          copy target/idl/*.json -> sdk/idl/
#   ./scripts/sync_idl.sh --check  fail if sdk/idl/ differs from target/idl/ (CI drift gate)
set -euo pipefail
cd "$(dirname "$0")/.."
PROGRAMS=(window_registry window_auction window_oracle window_wrap window_credit)
mkdir -p sdk/idl
status=0
for p in "${PROGRAMS[@]}"; do
  src="target/idl/$p.json"; dst="sdk/idl/$p.json"
  [ -f "$src" ] || { echo "sync_idl: missing $src (run anchor build)"; exit 1; }
  if [ "${1:-}" = "--check" ]; then
    if ! cmp -s "$src" "$dst"; then echo "sync_idl: $dst is stale"; status=1; fi
  else
    cp "$src" "$dst"; echo "sync_idl: $dst"
  fi
done
[ $status -eq 0 ] && [ "${1:-}" = "--check" ] && echo "sync_idl: frozen IDLs match"
exit $status

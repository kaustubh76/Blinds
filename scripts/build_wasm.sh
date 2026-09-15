#!/usr/bin/env bash
# Builds crates/window-proofs-wasm into sdk/wasm (ES module, no bundler required).
set -euo pipefail
cd "$(dirname "$0")/.."
wasm-pack build crates/window-proofs-wasm --target web --release --out-dir "$(pwd)/sdk/wasm" --out-name window_proofs
rm -f sdk/wasm/.gitignore sdk/wasm/package.json
ls -la sdk/wasm

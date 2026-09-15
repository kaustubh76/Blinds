#!/usr/bin/env bash
# Fresh-build guarantee (docs/SPEC_AMENDMENTS.md A9): nothing in this repository derives from the
# earlier Avalanche/eERC project. The spec itself names its lineage in a few sections; nothing else may.
set -euo pipefail
cd "$(dirname "$0")/.."
pattern='eERC|BabyJubJub|circom|snarkjs|M-ONIA|MONIA|Avalanche|Fuji'
if grep -rnE "$pattern" --include='*.rs' --include='*.ts' --include='*.tsx' --include='*.toml' \
   --include='*.json' --include='*.md' --include='*.sh' --include='*.mjs' . \
   --exclude-dir=node_modules --exclude-dir=target --exclude-dir=.git --exclude-dir=dist \
   | grep -v '^./docs/SPEC.md' | grep -v '^./docs/BUILD_PLAN.md' | grep -v '^./docs/SPEC_AMENDMENTS.md' \
   | grep -v 'check_lineage.sh'; then
  echo "check_lineage: reference to the prior project found"; exit 1
fi
echo "check_lineage: ok"

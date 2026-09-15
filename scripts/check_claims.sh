#!/usr/bin/env bash
# Spec §14 honest-claims rule, enforced: the product never *claims* to be "trustless",
# "undecryptable", or that "nobody can see". Mentioning a forbidden phrase inside straight double
# quotes (to forbid it) is allowed; asserting it is not.
set -euo pipefail
cd "$(dirname "$0")/.."
python3 - <<'PY'
import os, re, sys
forbidden = re.compile(r'trustless|undecryptable|nobody can see|no one can see|fully anonymous|impossible to decrypt', re.I)
quoted = re.compile(r'"[^"\n]*"')
skip_files = {'docs/SPEC.md', 'docs/BUILD_PLAN.md', 'docs/SPEC_AMENDMENTS.md', 'scripts/check_claims.sh'}
roots = ['README.md', 'docs', 'app/src', 'sdk/src', 'services']
bad = []
for root in roots:
    paths = [root] if os.path.isfile(root) else [os.path.join(d, f) for d, _, fs in os.walk(root) for f in fs]
    for p in paths:
        rel = os.path.relpath(p)
        if rel in skip_files or 'honestClaims' in rel or 'node_modules' in rel or rel.endswith(('.png', '.svg', '.wasm')):
            continue
        try:
            text = open(p, encoding='utf-8').read()
        except (UnicodeDecodeError, FileNotFoundError):
            continue
        for n, line in enumerate(text.splitlines(), 1):
            stripped = quoted.sub('""', line)   # a quoted phrase is a mention, not a claim
            if forbidden.search(stripped):
                bad.append(f'{rel}:{n}: {line.strip()}')
if bad:
    print('check_claims: forbidden claim (spec §14):'); print('\n'.join(bad)); sys.exit(1)
print('check_claims: ok')
PY

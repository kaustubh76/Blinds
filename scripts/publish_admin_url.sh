#!/usr/bin/env bash
# Commits and pushes deployments/admin-url.txt so the hosted dashboard (GitHub Pages) can find the
# faucet without the `?admin=` link. Pages redeploys in a minute or two; its edge cache can hold the
# old file for up to ~10 minutes more, which is why the link `market.sh start` prints is the primary path.
set -euo pipefail
cd "$(dirname "$0")/.."
url="$(grep -v '^#' deployments/admin-url.txt | grep -m1 . || true)"
if git diff --quiet -- deployments/admin-url.txt; then
  echo "admin-url.txt unchanged (${url:-empty}); nothing to publish"
  exit 0
fi
git add deployments/admin-url.txt
git commit -q -m "admin-url: ${url:-cleared}"
git push -q
echo "published: ${url:-cleared} — Pages will redeploy"

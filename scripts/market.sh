#!/usr/bin/env bash
# Starts, stops or inspects the live market (administrator + keeper + operator + price poster, plus
# the simulated members). The market only costs SOL while it runs — ~0.032 SOL per epoch, all of it
# rent for accounts that stay on chain so old prints remain verifiable — so run it in windows.
#
#   ./scripts/market.sh start [cluster]   # default devnet, reads .env for the auditor seed
#   ./scripts/market.sh stop
#   ./scripts/market.sh status
set -euo pipefail
cd "$(dirname "$0")/.."
CLUSTER="${2:-${WINDOW_CLUSTER:-devnet}}"
PROFILE="${WINDOW_PROFILE:-$CLUSTER}"
ADMIN_LOG="${WINDOW_ADMIN_LOG:-/tmp/window-admin-$CLUSTER.log}"
AGENTS_LOG="${WINDOW_AGENTS_LOG:-/tmp/window-agents-$CLUSTER.log}"
BIN=./target/release/window-admin

case "${1:-status}" in
  start)
    [ -f "$BIN" ] || { echo "build it first: cargo build -p window-admin --release"; exit 1; }
    [ -f .env ] && { set -a; . ./.env; set +a; }
    : "${WINDOW_AUDITOR_SEED_HEX:?the auditor seed must be the same one the deployment was set up with}"
    pgrep -f "window-admin --cluster $CLUSTER" >/dev/null && { echo "already running"; exit 0; }
    nohup "$BIN" --cluster "$CLUSTER" --profile "$PROFILE" run --metrics-port "${WINDOW_METRICS_PORT:-9090}" \
      >>"$ADMIN_LOG" 2>&1 &
    nohup "$BIN" --cluster "$CLUSTER" --profile "$PROFILE" agents >>"$AGENTS_LOG" 2>&1 &
    sleep 5
    echo "market running on $CLUSTER (profile $PROFILE)"
    echo "  admin  $ADMIN_LOG"
    echo "  agents $AGENTS_LOG"
    echo "  metrics http://127.0.0.1:${WINDOW_METRICS_PORT:-9090}/metrics"
    ;;
  stop)
    pkill -f "window-admin --cluster $CLUSTER" 2>/dev/null && echo "market stopped" || echo "not running"
    ;;
  status)
    if pgrep -f "window-admin --cluster $CLUSTER" >/dev/null; then
      echo "running on $CLUSTER"
      curl -s "http://127.0.0.1:${WINDOW_METRICS_PORT:-9090}/metrics" 2>/dev/null | grep -E "^window_" || true
    else
      echo "stopped on $CLUSTER"
    fi
    if [ "$CLUSTER" = devnet ] && command -v solana >/dev/null; then
      bal=$(solana balance -ud 2>/dev/null | awk '{print $1}')
      # ~0.032 SOL per epoch at ~7-minute epochs (docs/DEMO.md §C), i.e. ~0.28 SOL/hour.
      [ -n "$bal" ] && printf 'balance: %s SOL (~%.0f h of live market left)\n' "$bal" "$(echo "$bal" | awk '{print $1/0.28}')"
    fi
    ;;
  *) echo "usage: $0 {start|stop|status} [cluster]"; exit 2 ;;
esac

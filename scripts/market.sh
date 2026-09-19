#!/usr/bin/env bash
# Starts, stops or inspects the live market (administrator + keeper + operator + price poster, plus
# the simulated members). The market only costs SOL while it runs — ~0.032 SOL per epoch, all of it
# rent for accounts that stay on chain so old prints remain verifiable — so run it in windows.
#
#   ./scripts/market.sh start [cluster]   # default devnet, reads .env for the auditor seed
#   ./scripts/market.sh stop
#   ./scripts/market.sh status
#   ./scripts/market.sh tunnel            # replace a dead quick tunnel (URL rotates) without restarting
#
# With `cloudflared` installed (brew install cloudflared), `start` also opens a quick tunnel to the
# admin service so the hosted dashboard's faucet works: it writes the public URL to
# deployments/admin-url.txt and prints a shareable link (`?admin=<url>`). The faucet is limited
# (WINDOW_JOIN_MAX_PER_HOUR, WINDOW_JOIN_MIN_BALANCE_SOL; a wallet is funded once).
set -euo pipefail
cd "$(dirname "$0")/.."
CLUSTER="${2:-${WINDOW_CLUSTER:-devnet}}"
PROFILE="${WINDOW_PROFILE:-$CLUSTER}"
ADMIN_LOG="${WINDOW_ADMIN_LOG:-/tmp/window-admin-$CLUSTER.log}"
AGENTS_LOG="${WINDOW_AGENTS_LOG:-/tmp/window-agents-$CLUSTER.log}"
TUNNEL_LOG="${WINDOW_TUNNEL_LOG:-/tmp/window-tunnel-$CLUSTER.log}"
POSTER_LOG="${WINDOW_POSTER_LOG:-/tmp/window-pyth-poster-$CLUSTER.log}"
BIN=./target/release/window-admin
PORT="${WINDOW_METRICS_PORT:-9090}"
APP_URL="$(grep -v '^#' deployments/app-url.txt 2>/dev/null | grep -m1 . || echo 'https://kaustubh76.github.io/Blinds/')"
URL_FILE=deployments/admin-url.txt

write_admin_url() {
  { grep '^#' "$URL_FILE" 2>/dev/null || true; if [ -n "${1:-}" ]; then echo "$1"; fi; } > "$URL_FILE.tmp" && mv "$URL_FILE.tmp" "$URL_FILE"
}
current_admin_url() { grep -v '^#' "$URL_FILE" 2>/dev/null | grep -m1 . || true; }

open_tunnel() {
  # A quick tunnel does not reconnect after a long network outage: the process stays up while the
  # link is dead. `tunnel` (or a restart) replaces it; the URL rotates, so the share link does too.
  if pgrep -f "cloudflared tunnel --url http://127.0.0.1:$PORT" >/dev/null; then
    url="$(current_admin_url)"
    if [ -n "$url" ] && curl -s -m 8 "$url/healthz" >/dev/null 2>&1; then echo "  faucet  $url (up)"; return 0; fi
    pkill -f "cloudflared tunnel --url http://127.0.0.1:$PORT" 2>/dev/null || true
    sleep 1
  fi
  : > "$TUNNEL_LOG"
  nohup cloudflared tunnel --url "http://127.0.0.1:$PORT" >>"$TUNNEL_LOG" 2>&1 &
  url=""
  for _ in $(seq 1 30); do
    url="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" | tail -1 || true)"
    [ -n "$url" ] && break
    sleep 1
  done
  if [ -n "$url" ]; then
    write_admin_url "$url"
    echo "  faucet  $url  (tunnel log $TUNNEL_LOG)"
    echo "  share   ${APP_URL}?admin=$url"
    echo "  publish ./scripts/publish_admin_url.sh   # optional: lets the hosted app find it without the link"
  else
    echo "  tunnel: cloudflared gave no URL in 30 s — see $TUNNEL_LOG"
  fi
}

case "${1:-status}" in
  start)
    [ -f "$BIN" ] || { echo "build it first: cargo build -p window-admin --release"; exit 1; }
    [ -f .env ] && { set -a; . ./.env; set +a; }
    : "${WINDOW_AUDITOR_SEED_HEX:?the auditor seed must be the same one the deployment was set up with}"
    pgrep -f "window-admin --cluster $CLUSTER" >/dev/null && { echo "already running"; exit 0; }
    nohup "$BIN" --cluster "$CLUSTER" --profile "$PROFILE" run --metrics-port "${WINDOW_METRICS_PORT:-9090}" \
      >>"$ADMIN_LOG" 2>&1 &
    nohup "$BIN" --cluster "$CLUSTER" --profile "$PROFILE" agents >>"$AGENTS_LOG" 2>&1 &
    # Stage 4: with a Pyth key, the poster carries Pyth's signed TSLAX update onto this cluster so a
    # `price_source = 4` listing reads Pyth's own account (services/pyth-poster). Without the key the
    # keeper's cache path stays in force and the listing honestly reports its quote age.
    if [ -n "${PYTH_API_KEY:-}" ] && [ -d services/pyth-poster/node_modules ]; then
      if ! pgrep -f "tsx src/main.ts" >/dev/null; then
        (cd services/pyth-poster && WINDOW_CLUSTER="$CLUSTER" WINDOW_PROFILE="$PROFILE" nohup pnpm start >>"$POSTER_LOG" 2>&1 &)
      fi
      poster="  poster $POSTER_LOG"
    else
      poster="  poster not started (PYTH_API_KEY unset or services/pyth-poster not installed)"
    fi
    sleep 5
    echo "market running on $CLUSTER (profile $PROFILE)"
    echo "  admin  $ADMIN_LOG"
    echo "  agents $AGENTS_LOG"
    echo "$poster"
    echo "  metrics http://127.0.0.1:$PORT/metrics"
    if [ "$CLUSTER" = devnet ] && command -v cloudflared >/dev/null; then
      open_tunnel
    elif [ "$CLUSTER" = devnet ]; then
      echo "  faucet: not exposed (brew install cloudflared to tunnel it for the hosted dashboard)"
    fi
    ;;
  tunnel)
    [ "$CLUSTER" = devnet ] || { echo "tunnels are for devnet"; exit 1; }
    command -v cloudflared >/dev/null || { echo "brew install cloudflared"; exit 1; }
    pgrep -f "window-admin --cluster $CLUSTER" >/dev/null || { echo "start the market first"; exit 1; }
    open_tunnel
    ;;
  stop)
    pkill -f "window-admin --cluster $CLUSTER" 2>/dev/null && echo "market stopped" || echo "not running"
    if pkill -f "tsx src/main.ts" 2>/dev/null; then echo "poster stopped"; fi
    if pkill -f "cloudflared tunnel --url http://127.0.0.1:$PORT" 2>/dev/null; then echo "tunnel closed"; fi
    [ -n "$(current_admin_url)" ] && { write_admin_url ""; echo "admin-url.txt cleared (run ./scripts/publish_admin_url.sh to publish that)"; }
    ;;
  status)
    if pgrep -f "window-admin --cluster $CLUSTER" >/dev/null; then
      echo "running on $CLUSTER"
      if pgrep -f "tsx src/main.ts" >/dev/null; then
        echo "poster: running · last: $(grep -o '"msg":"posted".*"age_secs":[0-9-]*' "$POSTER_LOG" 2>/dev/null | tail -1 | grep -o '"publish_time":[0-9]*,"age_secs":[0-9-]*' || echo 'nothing posted yet')"
      else
        echo "poster: not running (Stage 4 needs PYTH_API_KEY)"
      fi
      curl -s "http://127.0.0.1:$PORT/metrics" 2>/dev/null | grep -E "^window_" || true
      url="$(current_admin_url)"
      if [ -n "$url" ]; then
        health="$(curl -s -m 5 "$url/healthz" 2>/dev/null || true)"
        echo "faucet: $url (${health:-unreachable}) · $(curl -s -m 5 "$url/faucet" 2>/dev/null || true)"
        echo "share:  ${APP_URL}?admin=$url"
      fi
    else
      echo "stopped on $CLUSTER"
    fi
    if [ "$CLUSTER" = devnet ] && command -v solana >/dev/null; then
      bal=$(solana balance -ud 2>/dev/null | awk '{print $1}')
      # ~0.032 SOL per epoch at ~7-minute epochs (docs/DEMO.md §C), i.e. ~0.28 SOL/hour.
      [ -n "$bal" ] && printf 'balance: %s SOL (~%.0f h of live market left)\n' "$bal" "$(echo "$bal" | awk '{print $1/0.28}')"
    fi
    ;;
  *) echo "usage: $0 {start|stop|status|tunnel} [cluster]"; exit 2 ;;
esac

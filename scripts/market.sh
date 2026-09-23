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
    echo "  watch   ./scripts/watch_tunnels.sh start   # keeps this tunnel (and serve_app.sh's) alive"
  else
    echo "  tunnel: cloudflared gave no URL in 30 s — see $TUNNEL_LOG"
  fi
}

case "${1:-status}" in
  start)
    [ -f "$BIN" ] || { echo "build it first: cargo build -p window-admin --release"; exit 1; }
    # A release binary older than the source runs yesterday's keeper: that is how a market once served
    # /marks without the fields the code already had. Refuse rather than mislead (WINDOW_SKIP_BUILD_CHECK=1 to skip).
    if [ -z "${WINDOW_SKIP_BUILD_CHECK:-}" ]; then
      newer=$(find services/admin/src crates programs -name '*.rs' -newer "$BIN" -print -quit 2>/dev/null || true)
      if [ -n "$newer" ]; then
        echo "refusing to start: $BIN is older than $newer"
        echo "  cargo build -p window-admin --release   # then start again"
        exit 1
      fi
    fi
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
      # What it actually cost, not what a model says it should: count the epochs this log holds and the
      # hours between the first and the last, at 0.032 SOL of rent per epoch (docs/DEMO.md §C). Epoch
      # length is a slot count, and devnet's slot time moves (0.45 s until mid-Sep 2026, ~0.17 s since
      # 22 Sep), so the wall-clock rate is only ever known by measuring it.
      # One pass, no `grep -m1`: that closes the pipe early and `set -euo pipefail` would end the script.
      stats=$(sed 's/\x1b\[[0-9;]*m//g' "$ADMIN_LOG" 2>/dev/null |
        awk '/epoch opened/ { if (!f) f = substr($0, 1, 19); l = substr($0, 1, 19); n++ } END { if (n) print f, l, n }' || true)
      first=$(echo "$stats" | awk '{print $1}')
      last=$(echo "$stats" | awk '{print $2}')
      epochs=$(echo "$stats" | awk '{print $3}')
      secs=""
      if [ -n "$first" ] && [ -n "$last" ]; then
        f=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "$first" +%s 2>/dev/null || date -u -d "$first" +%s 2>/dev/null)
        t=$(date -j -u -f "%Y-%m-%dT%H:%M:%S" "$last" +%s 2>/dev/null || date -u -d "$last" +%s 2>/dev/null)
        [ -n "$f" ] && [ -n "$t" ] && secs=$((t - f))
      fi
      if [ -n "$bal" ] && [ -n "$secs" ] && [ "$secs" -gt 600 ] && [ "${epochs:-0}" -gt 3 ]; then
        awk -v bal="$bal" -v e="$epochs" -v s="$secs" 'BEGIN {
          per_h = e / (s / 3600) * 0.032;
          printf "balance: %s SOL · measured %d epochs in %.1f h ≈ %.2f SOL/h of epoch rent (agent top-ups and the faucet add to it) → ~%.1f h left\n", bal, e, s / 3600, per_h, bal / per_h }'
      elif [ -n "$bal" ]; then
        printf 'balance: %s SOL (~%.0f h at 0.032 SOL/epoch and ~5 min epochs; run a while for a measured rate)\n' "$bal" "$(echo "$bal" | awk '{print $1/0.38}')"
      fi
    fi
    ;;
  *) echo "usage: $0 {start|stop|status|tunnel} [cluster]"; exit 2 ;;
esac

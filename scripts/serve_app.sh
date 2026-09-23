#!/usr/bin/env bash
# Serves the built dashboard from this machine through a Cloudflare quick tunnel — a stopgap public
# link for when GitHub Pages is unavailable. The URL rotates on every start and dies with the laptop,
# so start it on the day, not before; deployments/app-url.txt keeps pointing at the Pages site.
#
#   ./scripts/serve_app.sh start    # builds (devnet), serves app/dist on :4173, opens the tunnel, prints the link
#   ./scripts/serve_app.sh stop
#   ./scripts/serve_app.sh status
#   ./scripts/serve_app.sh refresh  # re-copy deployments/admin-url.txt into the served build
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:$HOME/Library/pnpm:$PATH"
PORT="${WINDOW_APP_PORT:-4173}"
APP_LOG="${WINDOW_APP_LOG:-/tmp/window-app-serve.log}"
TUNNEL_LOG="${WINDOW_APP_TUNNEL_LOG:-/tmp/window-app-tunnel.log}"
URL_FILE=/tmp/window-app-url.txt
# The directory served; point WINDOW_APP_DIST at a build of a clean checkout when the working tree is mid-edit.
DIST="${WINDOW_APP_DIST:-app/dist}"
admin_url() { grep -v '^#' deployments/admin-url.txt 2>/dev/null | grep -m1 . || true; }
# HTTP status of a tunnel URL, resolved through 1.1.1.1: a fresh trycloudflare name can sit in the
# local resolver's negative cache for minutes and look "down" while the world can reach it.
probe() {
  local host ip
  host="${1#https://}"; host="${host%%/*}"
  ip="$(nslookup "$host" 1.1.1.1 2>/dev/null | awk '/^Address: /{print $2}' | tail -1)"
  if [ -n "$ip" ]; then curl -s -m 8 --resolve "$host:443:$ip" -o /dev/null -w '%{http_code}' "$1/" 2>/dev/null || true
  else curl -s -m 8 -o /dev/null -w '%{http_code}' "$1/" 2>/dev/null || true; fi
}

case "${1:-status}" in
  start)
    command -v cloudflared >/dev/null || { echo "brew install cloudflared first"; exit 1; }
    if [ "${WINDOW_APP_SKIP_BUILD:-0}" != 1 ]; then
      echo "building the dashboard for devnet (base /)…"
      pnpm -s --filter @thewindow/solana-sdk build >/dev/null
      VITE_BASE=/ VITE_CLUSTER=devnet VITE_RPC_URL="${VITE_RPC_URL:-https://api.devnet.solana.com}" \
        VITE_MAINNET_RPC_URL="${VITE_MAINNET_RPC_URL:-https://solana-rpc.publicnode.com}" VITE_ADMIN_URL= \
        pnpm -s --filter @thewindow/app build >/dev/null
    fi
    cp deployments/admin-url.txt "$DIST/admin-url.txt"
    # A plain static server: the app is a hash-routed SPA, and Vite's preview refuses unknown hosts.
    pgrep -f "http.server $PORT" >/dev/null || {
      : > "$APP_LOG"
      (cd "$DIST" && nohup python3 -m http.server "$PORT" --bind 127.0.0.1 >>"$APP_LOG" 2>&1 </dev/null &)
    }
    pgrep -f "cloudflared tunnel --url http://127.0.0.1:$PORT" >/dev/null || {
      : > "$TUNNEL_LOG"
      nohup cloudflared tunnel --url "http://127.0.0.1:$PORT" >>"$TUNNEL_LOG" 2>&1 </dev/null &
    }
    url=""
    for _ in $(seq 1 30); do
      # `api.trycloudflare.com` is cloudflared's own control host — it appears in the log when a quick
    # tunnel fails to start, and publishing it points the dashboard at nothing. Take a named tunnel only.
    url="$(grep -o 'https://[a-z0-9-]*\.trycloudflare\.com' "$TUNNEL_LOG" | grep -v '^https://api\.' | tail -1 || true)"
      [ -n "$url" ] && break
      sleep 1
    done
    [ -n "$url" ] || { echo "cloudflared gave no URL in 30 s — see $TUNNEL_LOG"; exit 1; }
    echo "$url" > "$URL_FILE"
    for _ in $(seq 1 15); do [ "$(probe "$url")" = 200 ] && break; sleep 2; done
    a="$(admin_url)"
    echo "dashboard  $url"
    if [ -n "$a" ]; then echo "with faucet ${url}/?admin=$a"; else echo "no faucet URL yet: ./scripts/market.sh start first, then re-run status"; fi
    ;;
  refresh)
    # The faucet pointer changed (market.sh start/tunnel/stop): re-copy it into the served directory.
    cp deployments/admin-url.txt "$DIST/admin-url.txt" && echo "admin-url.txt refreshed: $(admin_url)"
    ;;
  stop)
    pkill -f "cloudflared tunnel --url http://127.0.0.1:$PORT" 2>/dev/null && echo "tunnel closed" || true
    pkill -f "http.server $PORT" 2>/dev/null && echo "server stopped" || echo "not running"
    rm -f "$URL_FILE"
    ;;
  status)
    if pgrep -f "http.server $PORT" >/dev/null && [ -f "$URL_FILE" ]; then
      url="$(cat "$URL_FILE")"; a="$(admin_url)"
      echo "serving  $url ($(probe "$url"))"
      [ -n "$a" ] && echo "faucet   ${url}/?admin=$a" || true
    else
      echo "not serving"
    fi
    ;;
  *) echo "usage: $0 {start|stop|status|refresh}"; exit 2 ;;
esac

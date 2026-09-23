#!/usr/bin/env bash
# Judging day, in one command. Nothing here is new capability — it is the order of the steps, so that
# none of them is forgotten while someone is waiting: start the market, keep the tunnel alive, publish
# the faucet URL for the hosted site, wait for a window to open, then prove from the outside that the
# hosted dashboard works (every route, every wallet-free recipe) before anyone is watching.
#
#   ./scripts/judging_day.sh up       # bring it all up and verify it (~4 min, mostly waiting for a window)
#   ./scripts/judging_day.sh status   # what is running, what it costs, where the window is
#   ./scripts/judging_day.sh down     # stop everything and clear the published pointer
#
# The market costs SOL while it runs (`market.sh status` measures it); run it in windows and take it
# down afterwards. Everything already printed stays on chain and stays verifiable.
set -euo pipefail
cd "$(dirname "$0")/.."
CLUSTER="${2:-${WINDOW_CLUSTER:-devnet}}"
ADMIN_LOG="${WINDOW_ADMIN_LOG:-/tmp/window-admin-$CLUSTER.log}"
APP_URL="$(grep -v '^#' deployments/app-url.txt 2>/dev/null | grep -m1 . || echo 'https://kaustubh76.github.io/Blinds/')"
URL_FILE=deployments/admin-url.txt
MIN_SOL="${JUDGING_MIN_SOL:-0.3}"

admin_url() { grep -v '^#' "$URL_FILE" 2>/dev/null | grep -m1 . || true; }
plain() { sed 's/\x1b\[[0-9;]*m//g'; }

# The last epoch event in the log, as "<opened|closed|printed> <epoch> <HH:MM:SS>".
window_phase() {
  plain <"$ADMIN_LOG" 2>/dev/null |
    awk '/epoch opened|epoch closed|printed epoch/ { t = substr($0, 12, 8); if (/epoch opened/) k = "open"; else if (/epoch closed/) k = "closed"; else k = "printed"; match($0, /epoch=[0-9]+/); e = substr($0, RSTART + 6, RLENGTH - 6); last = k " " e " at " t } END { if (last) print last; else print "no epoch yet" }'
}

case "${1:-status}" in
  up)
    if command -v solana >/dev/null; then
      bal=$(solana balance -u"${CLUSTER:0:1}" 2>/dev/null | awk '{print $1}' || true)
      if [ -n "${bal:-}" ] && awk -v b="$bal" -v m="$MIN_SOL" 'BEGIN { exit !(b < m) }'; then
        echo "refusing to start: the $CLUSTER wallet holds $bal SOL (floor $MIN_SOL)."
        echo "top up at https://faucet.solana.com (GitHub login, 5 SOL) and run this again."
        exit 1
      fi
    fi
    ./scripts/market.sh start "$CLUSTER"
    # WINDOW_PUBLISH=1: a quick tunnel's name rotates when it is replaced, and the hosted site reads the
    # committed pointer — without this, a rotation mid-demo leaves the faucet pointing at a dead URL.
    WINDOW_PUBLISH=1 ./scripts/watch_tunnels.sh start || true
    ./scripts/publish_admin_url.sh || echo "note: could not publish the admin URL (push it yourself, or share the ?admin= link)"
    url="$(admin_url)"
    echo
    echo "waiting for the first window to open (a keeper tick, usually under two minutes)…"
    for _ in $(seq 1 60); do
      case "$(window_phase)" in open*) break ;; esac
      sleep 10
    done
    echo "window: $(window_phase)"
    echo
    echo "what the chain would accept right now:"
    WINDOW_RPC_URL="https://api.$CLUSTER.solana.com" pnpm -s schedule 2>/dev/null | grep -E "ACCEPTED|REFUSED|usable" || true
    if [ -n "$url" ]; then
      echo
      echo "checking the hosted dashboard from the outside…"
      (cd scripts/smoke && node routes.mjs "${APP_URL%/}" 2>/dev/null |
        python3 -c 'import json,sys; d=json.load(sys.stdin); bad={k:(v["pageErrors"],v["http4xx5xx"]) for k,v in d.items() if v["pageErrors"] or v["http4xx5xx"]}; print("routes: all clean" if not bad else f"routes: {bad}")') || echo "routes: driver unavailable"
      (cd scripts/smoke && node recipes.mjs "${APP_URL%/}#/build" 2>/dev/null |
        python3 -c 'import json,sys; d=json.load(sys.stdin)["out"]; bad=[k for k,v in d.items() if not isinstance(v,dict) or v.get("state")!="confirmed"]; print("recipes: all confirmed" if not bad else f"recipes: not confirmed {bad}")') || echo "recipes: driver unavailable"
    fi
    echo
    echo "── ready ──"
    [ -n "$url" ] && echo "share:   ${APP_URL%/}/?admin=$url"
    echo "window:  $(window_phase)   (a window is open ~8 min of every ~15; seal the demo bid while it is open)"
    echo "check:   pnpm schedule · ./scripts/judging_day.sh status · docs/DEMO_SCRIPT.md"
    echo "after:   ./scripts/judging_day.sh down"
    ;;
  status)
    ./scripts/market.sh status "$CLUSTER"
    echo "window:  $(window_phase)"
    url="$(admin_url)"
    echo "faucet:  ${url:-not published}"
    [ -n "$url" ] && echo "share:   ${APP_URL%/}/?admin=$url"
    ./scripts/watch_tunnels.sh status 2>/dev/null || true
    ;;
  down)
    ./scripts/watch_tunnels.sh stop 2>/dev/null || true
    ./scripts/market.sh stop "$CLUSTER"
    ./scripts/publish_admin_url.sh || true
    echo "down. Every print stays on chain and stays verifiable; the dashboard keeps working without the faucet."
    ;;
  *)
    echo "usage: $0 {up|status|down} [cluster]"
    exit 2
    ;;
esac

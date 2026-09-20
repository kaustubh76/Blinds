#!/usr/bin/env bash
# Keeps the two Cloudflare quick tunnels alive: the faucet's (market.sh) and the dashboard's
# (serve_app.sh). A quick tunnel does not reconnect after a long network outage — the cloudflared
# process stays up while the link is dead — so this loop probes both every minute (through 1.1.1.1,
# past the local resolver's cache), replaces a dead one, re-copies the faucet pointer into the served
# build and logs the current share link. With WINDOW_PUBLISH=1 it also commits the pointer for the
# hosted site (publish_admin_url.sh).
#
#   ./scripts/watch_tunnels.sh start | stop | status        log: /tmp/window-tunnels.log
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/opt/homebrew/bin:$HOME/Library/pnpm:$PATH"
LOG="${WINDOW_TUNNELS_LOG:-/tmp/window-tunnels.log}"
PID_FILE=/tmp/window-tunnels.pid
INTERVAL="${WINDOW_TUNNELS_INTERVAL:-60}"
APP_URL_FILE=/tmp/window-app-url.txt

admin_url() { grep -v '^#' deployments/admin-url.txt 2>/dev/null | grep -m1 . || true; }
probe() {
  local host ip
  host="${1#https://}"; host="${host%%/*}"
  ip="$(nslookup "$host" 1.1.1.1 2>/dev/null | awk '/^Address: /{print $2}' | tail -1)"
  if [ -n "$ip" ]; then curl -s -m 8 --resolve "$host:443:$ip" -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true
  else curl -s -m 8 -o /dev/null -w '%{http_code}' "$1" 2>/dev/null || true; fi
}
log() { echo "$(date -u +%FT%TZ) $*" >> "$LOG"; }

loop() {
  log "watching (every ${INTERVAL}s)"
  while true; do
    changed=0
    # faucet tunnel — only while the market runs
    if pgrep -f "window-admin --cluster devnet" >/dev/null; then
      a="$(admin_url)"
      if [ -z "$a" ] || [ "$(probe "$a/healthz")" != 200 ]; then
        log "faucet tunnel ${a:-<none>} down → market.sh tunnel"
        ./scripts/market.sh tunnel >>"$LOG" 2>&1 || log "market.sh tunnel failed"
        changed=1
      fi
    fi
    # dashboard tunnel — only while serve_app.sh runs
    if pgrep -f "http.server ${WINDOW_APP_PORT:-4173}" >/dev/null; then
      u="$(cat "$APP_URL_FILE" 2>/dev/null || true)"
      if [ -z "$u" ] || [ "$(probe "$u/")" != 200 ]; then
        log "dashboard tunnel ${u:-<none>} down → serve_app.sh restart"
        ./scripts/serve_app.sh stop >>"$LOG" 2>&1 || true
        WINDOW_APP_SKIP_BUILD=1 ./scripts/serve_app.sh start >>"$LOG" 2>&1 || log "serve_app.sh start failed"
        changed=1
      fi
    fi
    if [ "$changed" = 1 ]; then
      ./scripts/serve_app.sh refresh >>"$LOG" 2>&1 || true
      [ "${WINDOW_PUBLISH:-0}" = 1 ] && { ./scripts/publish_admin_url.sh >>"$LOG" 2>&1 || log "publish failed"; }
      u="$(cat "$APP_URL_FILE" 2>/dev/null || true)"; a="$(admin_url)"
      log "share: ${u:-<no dashboard tunnel>}${a:+/?admin=$a}"
    fi
    sleep "$INTERVAL"
  done
}

case "${1:-status}" in
  start)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then echo "already watching (pid $(cat "$PID_FILE"))"; exit 0; fi
    nohup "$0" _loop >>"$LOG" 2>&1 </dev/null &
    echo $! > "$PID_FILE"
    echo "watching tunnels every ${INTERVAL}s (pid $!, log $LOG)"
    ;;
  _loop) loop ;;
  stop)
    if [ -f "$PID_FILE" ]; then kill "$(cat "$PID_FILE")" 2>/dev/null && echo "stopped" || echo "not running"; rm -f "$PID_FILE"; else echo "not running"; fi
    ;;
  status)
    if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then echo "watching (pid $(cat "$PID_FILE"))"; tail -n 3 "$LOG" 2>/dev/null || true
    else echo "not watching"; fi
    ;;
  *) echo "usage: $0 {start|stop|status}"; exit 2 ;;
esac

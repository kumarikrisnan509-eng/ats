#!/usr/bin/env bash
# morning-check.sh
#
# Runs at 06:15 IST (00:45 UTC) every day via /etc/cron.d/ats-auto-login.
# (T-426 audit-2026-05-26 C1: corrected stale comment that said 08:50 IST.
#  The real schedule is written by setup-auto-login-cron.sh -- 45 0 * * *.)
# 1. Adds 0-60s jitter
# 2. Checks if already connected (skips if yes)
# 3. Runs auto-login-host.js (which drives Kite UI via host-side Playwright)
# 4. Telegram notification is sent by the backend's notify.js after exchange
set -uo pipefail

# T-426 (audit-2026-05-26 VM-scripts C2): flock to prevent overlap with
# bulk-rotate.timer (systemd, 00:15 UTC + 600s jitter) which can land
# within ~30min of this script (00:45 UTC + 60s jitter). Concurrent
# rotations of the same broker_account race the DB UPDATE on access_token
# -- one of the two writes a token Kite has already invalidated, and the
# in-memory broker singleton ends up out-of-sync with the DB.
# Same lock name in bulk-rotate path so they serialise.
LOCK_FILE="/var/lock/ats-reauth.lock"
exec 9>"$LOCK_FILE" || { echo "[morning-check] cannot open lock file $LOCK_FILE" >&2; exit 0; }
if ! flock -n 9; then
    logger -t ats-morning-check "another reauth holds $LOCK_FILE -- exiting silently"
    exit 0
fi
# Lock is held on FD 9 for the lifetime of this shell; auto-released on exit.

sleep $((RANDOM % 60))

log() { logger -t ats-morning-check "$*"; echo "[$(date -u +%H:%M:%SZ)] $*"; }

HEALTH=$(curl -sS --max-time 5 http://127.0.0.1:8080/api/health 2>/dev/null || echo "")
if [ -z "$HEALTH" ]; then
    log "health endpoint unreachable — backend may be down"
    # Tell user via Telegram if env vars are present
    if [ -r /etc/ats/backend.env ]; then
        set +u; . /etc/ats/backend.env; set -u
        if [ -n "${TELEGRAM_BOT_TOKEN:-}" ] && [ -n "${TELEGRAM_CHAT_ID:-}" ]; then
            curl -sS -X POST "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
                --data-urlencode "chat_id=${TELEGRAM_CHAT_ID}" \
                --data-urlencode "text=❌ ATS morning check: backend unreachable" > /dev/null
        fi
    fi
    exit 1
fi

# T-334: also probe /api/profile -- broker.connected reflects WEBSOCKET
# state which Zerodha keeps alive even after they invalidate the daily HTTP
# API token at ~06:00 IST. Without this check, the cron skipped auto-login
# every morning because the WS was up, leaving the HTTP token broken until
# manual operator reauth.
CONNECTED=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin)['broker']['connected'])" 2>/dev/null || echo "")
PROFILE_OK=$(curl -sS --max-time 5 http://127.0.0.1:8080/api/profile 2>/dev/null | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('ok') is True)" 2>/dev/null || echo "False")
if [ "$CONNECTED" = "True" ] || [ "$CONNECTED" = "true" ]; then
    if [ "$PROFILE_OK" = "True" ]; then
        log "already connected AND profile call works -- skipping auto-login"
        exit 0
    fi
    log "WS connected but /api/profile fails -- token is stale, proceeding with auto-login"
fi

log "running auto-login-host.js"
/usr/bin/timeout --signal=KILL 180s /usr/bin/node /opt/ats/scripts/auto-login-host.js
RC=$?
log "auto-login exit code: $RC"
exit $RC

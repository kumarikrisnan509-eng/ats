#!/usr/bin/env bash
# morning-check.sh
#
# Runs at 08:50 IST (03:20 UTC) on weekdays via /etc/cron.d/ats-auto-login.
# 1. Adds 0-60s jitter
# 2. Checks if already connected (skips if yes)
# 3. Runs auto-login-host.js (which drives Kite UI via host-side Playwright)
# 4. Telegram notification is sent by the backend's notify.js after exchange
set -uo pipefail

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

CONNECTED=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin)['broker']['connected'])" 2>/dev/null || echo "")
if [ "$CONNECTED" = "True" ] || [ "$CONNECTED" = "true" ]; then
    log "already connected — skipping auto-login"
    exit 0
fi

log "running auto-login-host.js"
/usr/bin/node /opt/ats/scripts/auto-login-host.js
RC=$?
log "auto-login exit code: $RC"
exit $RC

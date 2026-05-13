#!/usr/bin/env bash
# morning-check.sh
#
# Runs at 08:50 IST (03:20 UTC) on weekdays via /etc/cron.d/ats-auto-login.
# Triggers the auto-login flow and sends Telegram notifications on success/failure.
#
# Flow:
#   1. Add small random jitter (0-60s) to avoid pattern detection
#   2. Sanity check: container healthy, broker=zerodha
#   3. POST /api/brokers/zerodha/auto-login (loopback-only)
#   4. Wait 8s, re-check /api/health.broker.connected
#   5. Notify operator regardless of outcome
set -uo pipefail

# Jitter
sleep $((RANDOM % 60))

LOG_TAG="[ats-morning-check]"
HEALTH_URL="http://127.0.0.1:8080/api/health"
LOGIN_URL="http://127.0.0.1:8080/api/brokers/zerodha/auto-login"
PUBLIC_LOGIN="https://ats.rajasekarselvam.com/api/brokers/zerodha/login"

log() { logger -t ats-morning-check "$*"; echo "$LOG_TAG $*"; }

# Pull Telegram settings if backend.env has them (purely for the manual-fallback notify path
# — the backend itself reads from its container env and notifies internally).
TELEGRAM_BOT_TOKEN=""
TELEGRAM_CHAT_ID=""
if [ -r /etc/ats/backend.env ]; then
    # shellcheck disable=SC1091
    set +u; source /etc/ats/backend.env; set -u
fi

tg_send() {
    local text="$1"
    if [ -n "$TELEGRAM_BOT_TOKEN" ] && [ -n "$TELEGRAM_CHAT_ID" ]; then
        curl -sS --max-time 10 -X POST \
            "https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage" \
            -H 'Content-Type: application/json' \
            -d "{\"chat_id\":\"${TELEGRAM_CHAT_ID}\",\"text\":$(printf '%s' "$text" | python3 -c 'import sys,json; print(json.dumps(sys.stdin.read()))'),\"parse_mode\":\"Markdown\",\"disable_web_page_preview\":true}" \
            > /dev/null || true
    fi
}

log "starting at $(date -u +%FT%TZ)"

# Step 1: health
HEALTH=$(curl -sS --max-time 5 "$HEALTH_URL" 2>/dev/null || echo "")
if [ -z "$HEALTH" ]; then
    log "health endpoint not reachable"
    tg_send "❌ *ATS morning check FAILED*\n\n/api/health unreachable.\nManual login URL:\n${PUBLIC_LOGIN}"
    exit 1
fi

BROKER=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin)['broker']['name'])" 2>/dev/null || echo "")
if [ "$BROKER" != "zerodha" ]; then
    log "broker is $BROKER not zerodha — refusing auto-login"
    tg_send "⚠️ *ATS broker mode is \`$BROKER\`*, not zerodha. Skipping auto-login.\nFix /etc/ats/backend.env."
    exit 2
fi

CONNECTED=$(echo "$HEALTH" | python3 -c "import sys,json; print(json.load(sys.stdin)['broker']['connected'])" 2>/dev/null || echo "")
if [ "$CONNECTED" = "True" ] || [ "$CONNECTED" = "true" ]; then
    log "already connected — nothing to do"
    tg_send "ℹ️ *ATS already connected* this morning (no login needed)."
    exit 0
fi

# Step 2: trigger auto-login
log "calling $LOGIN_URL"
RESP=$(curl -sS --max-time 120 -X POST "$LOGIN_URL" \
    -H 'X-ATS-Internal: 1' \
    -H 'Content-Type: application/json' 2>&1)
RC=$?

log "auto-login response: $RESP (rc=$RC)"

# Step 3: re-check
sleep 8
HEALTH2=$(curl -sS --max-time 5 "$HEALTH_URL" 2>/dev/null || echo "")
CONNECTED2=$(echo "$HEALTH2" | python3 -c "import sys,json; print(json.load(sys.stdin)['broker']['connected'])" 2>/dev/null || echo "")

if [ "$CONNECTED2" = "True" ] || [ "$CONNECTED2" = "true" ]; then
    log "OK: connected after auto-login"
    # The backend already sends a success notification via notify.js — we don't double-send.
    exit 0
else
    log "FAIL: not connected after auto-login. response=$RESP"
    # The backend already sends a failure notification via notify.js — we don't double-send.
    exit 3
fi

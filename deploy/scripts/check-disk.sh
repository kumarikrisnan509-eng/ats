#!/usr/bin/env bash
# check-disk.sh -- run from cron every 15 minutes on the VM.
# Sends a Telegram alert if any of:
#   - / is more than 80% full
#   - /var/lib/ats is more than 2GB
#   - /var/log/ats has audit logs > 500MB combined
#
# Install:
#   sudo cp deploy/scripts/check-disk.sh /opt/ats/scripts/check-disk.sh
#   sudo chmod +x /opt/ats/scripts/check-disk.sh
#   sudo bash -c 'echo "*/15 * * * * ubuntu /opt/ats/scripts/check-disk.sh" > /etc/cron.d/ats-disk-check'

set -uo pipefail

# Read Telegram creds from the existing compose .env
ENV_FILE="${ATS_ENV_FILE:-/opt/ats/compose/.env}"
TOKEN=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
CHAT_ID=$(grep -E '^TELEGRAM_CHAT_ID=' "$ENV_FILE" 2>/dev/null | cut -d= -f2-)

alert() {
  local msg="$1"
  if [ -z "$TOKEN" ] || [ -z "$CHAT_ID" ]; then
    echo "[$(date -u +%FT%TZ)] ALERT (no telegram): $msg" >&2
    return
  fi
  curl -sS --max-time 10 -X POST \
    -d "chat_id=$CHAT_ID" \
    -d "text=[ATS-DISK] $msg" \
    "https://api.telegram.org/bot$TOKEN/sendMessage" > /dev/null || true
}

# 1. Root filesystem
USE_PCT=$(df -P / | awk 'NR==2 {sub("%",""); print $5}')
if [ "$USE_PCT" -ge 80 ]; then
  alert "root fs at ${USE_PCT}% on $(hostname)"
fi
if [ "$USE_PCT" -ge 95 ]; then
  alert "CRITICAL: root fs at ${USE_PCT}% on $(hostname) -- container restart imminent"
fi

# 2. ATS state dir size
STATE_MB=$(du -sm /var/lib/ats 2>/dev/null | awk '{print $1}')
if [ -n "$STATE_MB" ] && [ "$STATE_MB" -gt 2048 ]; then
  alert "/var/lib/ats is ${STATE_MB}MB (>2GB) -- check _instruments-cache.json and persistent JSON"
fi

# 3. Audit log + rotated logs
LOG_MB=$(du -smc /var/log/ats/audit.log* 2>/dev/null | tail -1 | awk '{print $1}')
if [ -n "$LOG_MB" ] && [ "$LOG_MB" -gt 500 ]; then
  alert "/var/log/ats is ${LOG_MB}MB -- check logrotate is firing"
fi

# 4. Docker image cleanup hint
DANGLING=$(sudo docker images -f 'dangling=true' -q 2>/dev/null | wc -l)
if [ "$DANGLING" -gt 20 ]; then
  alert "$DANGLING dangling docker images -- run 'sudo docker image prune -f'"
fi

exit 0

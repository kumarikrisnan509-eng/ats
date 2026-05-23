#!/usr/bin/env bash
# ============================================================
#  setup-auto-login-cron.sh — T99-T56 one-time install for the
#  host-side auto-login cron entry.
#
#  Lives at /etc/cron.d/ats-auto-login on the VM. Runs morning-check.sh
#  every day at 08:50 IST (03:20 UTC). T-31 made this 7 days/week
#  (was Mon-Fri) so weekend stalls (where Kite still invalidates tokens
#  daily) get auto-reauth'd.
#
#  Idempotent. Safe to re-run. Run after a fresh VM bootstrap or DR rebuild.
#
#  Usage:
#    sudo /opt/ats/scripts/setup-auto-login-cron.sh
# ============================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: run as root (sudo bash $0)" >&2
  exit 1
fi

CRON_PATH="/etc/cron.d/ats-auto-login"
MORNING_CHECK="/opt/ats/scripts/morning-check.sh"

echo "==> [1/3] verify $MORNING_CHECK is present + executable"
if [[ ! -x "$MORNING_CHECK" ]]; then
  echo "ERROR: $MORNING_CHECK not found or not executable." >&2
  echo "       Has the latest deploy landed?" >&2
  exit 2
fi
echo "    OK"

echo "==> [2/3] write $CRON_PATH (7 days/week, 08:50 IST = 03:20 UTC)"
cat > "$CRON_PATH" <<'CRONEOF'
# T99-T31: 7 days/week. Zerodha invalidates tokens daily at ~06:00 IST
# regardless of weekend/holiday, so the auto-login needs to run every day.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
# T-334: 00:45 UTC = 06:15 IST. Zerodha invalidates the daily access_token at
# ~06:00 IST -- running 15min AFTER ensures we refresh into a token that's
# valid for the whole trading day. The previous 03:20 UTC (08:50 IST) value
# was 2h 50m after expiry, leaving the morning window broken every day.
45 0 * * * ubuntu /opt/ats/scripts/morning-check.sh >> /var/log/ats/morning-check.log 2>&1
CRONEOF
chmod 0644 "$CRON_PATH"
# cron requires a trailing newline — re-emit just in case the heredoc strips it.
[ -n "$(tail -c1 "$CRON_PATH")" ] && echo >> "$CRON_PATH"
systemctl reload cron 2>/dev/null || systemctl restart cron 2>/dev/null || true
echo "    written + cron reloaded"

echo "==> [3/3] verify cron parses the file"
if journalctl -u cron --since "1 minute ago" 2>/dev/null | grep -q "$CRON_PATH"; then
  echo "    cron logged a (RE)LOAD of $CRON_PATH — good"
else
  echo "    (no cron RELOAD log yet; that's fine — wait ~30s + check journalctl)"
fi

echo ""
echo "DONE. Next fire: tomorrow at 08:50 IST + 0-60s jitter."
echo "To test the script NOW: sudo bash $MORNING_CHECK"

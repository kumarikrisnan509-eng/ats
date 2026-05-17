#!/usr/bin/env bash
# ============================================================
#  setup-rclone-archive.sh
#  Runs on the VM as root via sudo.
#  Non-interactive: installs rclone + writes logrotate + cron
#  skeleton. Does NOT do rclone OAuth (that's interactive and
#  the user does it in a separate SSH session via guide).
#  Does NOT enable the cron yet (will be enabled after OAuth
#  is verified).
# ============================================================
set -euo pipefail

REMOTE_NAME="${REMOTE_NAME:-ats-archive}"
REMOTE_DIR="${REMOTE_DIR:-ats-audit-archive}"
LOCAL_LOGDIR="/var/log/ats"
RCLONE_LOG="/var/log/ats-rclone.log"
WRAPPER="/usr/local/bin/ats-archive-audit.sh"
RCLONE_CONFIG_DIR="/root/.config/rclone"

echo "==> Installing rclone (via apt)"
apt-get update -y >/dev/null
apt-get install -y rclone >/dev/null
rclone version | head -1

echo "==> Creating logrotate config: /etc/logrotate.d/ats-audit"
cat > /etc/logrotate.d/ats-audit <<'EOF'
# Rotate the ATS audit log daily.
# We use copytruncate because the Node backend keeps the file
# handle open and appends synchronously; a clean rename+reload
# would need backend cooperation (SIGHUP handler) which we
# haven't wired yet. The duplicate-line risk during the copy
# window is acceptable for the audit log (entries are seq+ts).
/var/log/ats/audit.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    create 0644 ats ats
    dateext
    dateformat -%Y-%m-%d
}
EOF

echo "==> Creating archive wrapper: $WRAPPER"
cat > "$WRAPPER" <<EOF
#!/usr/bin/env bash
# Tier I1: extended in 2026-05 to cover SQLite + sealed tokens (was audit-only).
# Ships: rotated audit logs + SQLite snapshot + per-user sealed tokens to GDrive.
# Older-than-5-minute filter on audit avoids mid-rotation race. rclone copy is
# idempotent so already-uploaded files are skipped.
set -euo pipefail

REMOTE="${REMOTE_NAME}:${REMOTE_DIR}"
SQLITE_SRC="${SQLITE_SRC:-/var/lib/ats/tokens/ats.db}"  # T-39 fix: actual prod path
TOKENS_SRC="${TOKENS_SRC:-/var/lib/ats/tokens}"
SQLITE_STAGE="/var/tmp/ats-db-snapshot.db"

# === 1. Rotated audit logs ===
/usr/bin/rclone copy "$LOCAL_LOGDIR" "\$REMOTE/audit" \\
  --include "audit.log-*.gz" \\
  --min-age 5m \\
  --log-file "$RCLONE_LOG" \\
  --log-level INFO \\
  --stats-one-line --stats 1m

# === 2. SQLite snapshot (consistent read via .backup) ===
if [ -f "\$SQLITE_SRC" ] && command -v sqlite3 >/dev/null 2>&1; then
  sqlite3 "\$SQLITE_SRC" ".backup '\$SQLITE_STAGE'"
  /usr/bin/rclone copyto "\$SQLITE_STAGE" "\$REMOTE/db/ats.db" \\
    --log-file "$RCLONE_LOG" --log-level INFO || true
  rm -f "\$SQLITE_STAGE"
fi

# === 3. Sealed per-user tokens ===
if [ -d "\$TOKENS_SRC" ]; then
  /usr/bin/rclone copy "\$TOKENS_SRC" "\$REMOTE/tokens" \\
    --log-file "$RCLONE_LOG" --log-level INFO || true
fi
EOF
chmod +x "$WRAPPER"

echo "==> Creating cron skeleton (DISABLED until OAuth is verified)"
# We write the cron file in a .disabled state. The "verify and enable" step
# (after OAuth) just moves it into place.
cat > /etc/cron.d/ats-audit-rclone.disabled <<EOF
# Daily at 02:30 UTC (08:00 IST). Adjust if you prefer.
30 2 * * * root $WRAPPER >> $RCLONE_LOG 2>&1
EOF

echo "==> Ensuring rclone log file exists"
touch "$RCLONE_LOG"
chown root:root "$RCLONE_LOG"
chmod 0644 "$RCLONE_LOG"

echo "==> Ensuring rclone config dir exists for root"
mkdir -p "$RCLONE_CONFIG_DIR"
chmod 0700 "$RCLONE_CONFIG_DIR"

echo ""
echo "============================================================"
echo "  Non-interactive setup complete."
echo "============================================================"
echo "  Next (interactive, you do this):"
echo "   1. SSH to VM"
echo "   2. Run: sudo rclone config"
echo "   3. Follow the prompts (see RCLONE-CONFIG-GUIDE.md)"
echo "   4. Use remote name: $REMOTE_NAME"
echo "   5. After OAuth completes, run:"
echo "        sudo rclone lsd ${REMOTE_NAME}:"
echo "      (should succeed and list nothing or your existing folders)"
echo "   6. Tell me, and I'll enable the cron."
echo "============================================================"

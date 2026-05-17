#!/usr/bin/env bash
# ============================================================
#  ats-archive.sh — T99-T39: nightly backup wrapper.
#
#  Lives at /opt/ats/scripts/ats-archive.sh (auto-synced via deploy workflow).
#  Symlinked from /usr/local/bin/ats-archive-audit.sh by setup-rclone-archive.sh
#  for cron compatibility with the existing /etc/cron.d/ats-audit-rclone entry.
#
#  Pushes three things to the rclone remote nightly:
#    1. Rotated audit logs (audit.log-*.gz, min-age 5m to avoid mid-rotation race)
#    2. SQLite DB snapshot (.backup -- WAL-safe)
#    3. Sealed per-user Zerodha tokens
#
#  Defaults are correct for THIS VM. Override via env vars at the cron level
#  if a different deployment uses different paths.
# ============================================================
set -euo pipefail

REMOTE_NAME="${REMOTE_NAME:-ats-archive}"
REMOTE_DIR="${REMOTE_DIR:-ats-audit-archive}"
REMOTE="${REMOTE_NAME}:${REMOTE_DIR}"

LOCAL_LOGDIR="${LOCAL_LOGDIR:-/var/log/ats}"
SQLITE_SRC="${SQLITE_SRC:-/var/lib/ats/tokens/ats.db}"   # T-39 fix: actual prod path
TOKENS_SRC="${TOKENS_SRC:-/var/lib/ats/tokens}"
RCLONE_LOG="${RCLONE_LOG:-/var/log/ats-rclone.log}"

SQLITE_STAGE="/var/tmp/ats-db-snapshot.db"

log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$RCLONE_LOG"; }

log "===== ats-archive run start ====="

# === 1. Rotated audit logs ===
log "step: audit logs -> $REMOTE/audit"
/usr/bin/rclone copy "$LOCAL_LOGDIR" "$REMOTE/audit" \
  --include "audit.log-*.gz" \
  --min-age 5m \
  --log-file "$RCLONE_LOG" \
  --log-level INFO \
  --stats-one-line --stats 1m || log "WARN: audit rclone failed (non-fatal)"

# === 2. SQLite snapshot ===
if [ -f "$SQLITE_SRC" ] && command -v sqlite3 >/dev/null 2>&1; then
  log "step: sqlite .backup '$SQLITE_SRC' -> $SQLITE_STAGE -> $REMOTE/db/ats.db"
  if sqlite3 "$SQLITE_SRC" ".backup '$SQLITE_STAGE'" 2>>"$RCLONE_LOG"; then
    SIZE=$(stat -c%s "$SQLITE_STAGE" 2>/dev/null || echo 0)
    log "  snapshot size: $SIZE bytes"
    /usr/bin/rclone copyto "$SQLITE_STAGE" "$REMOTE/db/ats.db" \
      --log-file "$RCLONE_LOG" --log-level INFO \
      || log "WARN: db rclone failed (non-fatal)"
    rm -f "$SQLITE_STAGE"
  else
    log "WARN: sqlite3 .backup failed (see log above); skipping db backup"
  fi
elif [ ! -f "$SQLITE_SRC" ]; then
  log "WARN: SQLITE_SRC=$SQLITE_SRC not found; skipping db backup"
else
  log "WARN: sqlite3 CLI not installed; skipping db backup"
fi

# === 3. Sealed per-user tokens ===
if [ -d "$TOKENS_SRC" ]; then
  log "step: sealed tokens -> $REMOTE/tokens"
  /usr/bin/rclone copy "$TOKENS_SRC" "$REMOTE/tokens" \
    --log-file "$RCLONE_LOG" --log-level INFO \
    --exclude "ats.db*" \
    --exclude "_*" \
    || log "WARN: tokens rclone failed (non-fatal)"
else
  log "WARN: TOKENS_SRC=$TOKENS_SRC not found; skipping tokens backup"
fi

log "===== ats-archive run done ====="

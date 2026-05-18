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

# === 3. Sealed per-user tokens + small state JSON ===
# Includes:
#   *.enc                       sealed Zerodha access tokens
#   _alerts.json _watchlist.json _scanner.json   small persistent state
# Excludes:
#   ats.db*                     has its own /db/ path above
#   _instruments-cache.json     large (~20MB) + regenerable from Kite every morning
if [ -d "$TOKENS_SRC" ]; then
  log "step: sealed tokens + state -> $REMOTE/tokens"
  /usr/bin/rclone copy "$TOKENS_SRC" "$REMOTE/tokens" \
    --include "*.enc" \
    --include "_alerts.json" \
    --include "_watchlist.json" \
    --include "_scanner.json" \
    --log-file "$RCLONE_LOG" --log-level INFO \
    || log "WARN: tokens rclone failed (non-fatal)"
else
  log "WARN: TOKENS_SRC=$TOKENS_SRC not found; skipping tokens backup"
fi

# === 4. T99-T124 (v11-H7): ai_calls archive — export rows >90 days old to GDrive then DELETE locally ===
# Keeps the live DB lean (already capped at 5000 rows/user by trim trigger) while
# preserving full call history offsite for audit. CSV format for easy import.
# Path: $REMOTE/ai-calls/{YYYY-MM}/ai-calls-archive-{YYYY-MM-DD}.csv.gz
if [ -f "$SQLITE_SRC" ] && command -v sqlite3 >/dev/null 2>&1; then
  CUTOFF_DATE=$(date -u -d '90 days ago' +%Y-%m-%d 2>/dev/null || date -u -v-90d +%Y-%m-%d 2>/dev/null || echo "")
  if [ -n "$CUTOFF_DATE" ]; then
    AI_STAGE="/var/tmp/ats-ai-calls-archive-$(date -u +%Y-%m-%d).csv"
    COUNT=$(sqlite3 "$SQLITE_SRC" "SELECT COUNT(*) FROM ai_calls WHERE ts < '$CUTOFF_DATE';" 2>/dev/null || echo 0)
    if [ "$COUNT" -gt 0 ]; then
      log "step: ai_calls archive — $COUNT rows older than $CUTOFF_DATE -> $REMOTE/ai-calls/"
      # Export to CSV with header
      sqlite3 -header -csv "$SQLITE_SRC" "SELECT id, user_id, ts, workflow, provider, model, prompt_tokens, completion_tokens, cost_inr, status, error FROM ai_calls WHERE ts < '$CUTOFF_DATE' ORDER BY id;" > "$AI_STAGE" 2>>"$RCLONE_LOG"
      if [ -s "$AI_STAGE" ]; then
        gzip -f "$AI_STAGE"
        MONTH=$(date -u +%Y-%m)
        REMOTE_PATH="$REMOTE/ai-calls/$MONTH/$(basename "$AI_STAGE").gz"
        if /usr/bin/rclone copyto "$AI_STAGE.gz" "$REMOTE_PATH" --log-file "$RCLONE_LOG" --log-level INFO; then
          log "  uploaded $REMOTE_PATH"
          # Only DELETE locally if upload succeeded
          sqlite3 "$SQLITE_SRC" "DELETE FROM ai_calls WHERE ts < '$CUTOFF_DATE';" 2>>"$RCLONE_LOG"
          DEL_COUNT=$(sqlite3 "$SQLITE_SRC" "SELECT changes();" 2>/dev/null || echo 0)
          log "  deleted $DEL_COUNT local rows"
        else
          log "WARN: rclone copyto failed for ai-calls archive — keeping local rows for next run"
        fi
        rm -f "$AI_STAGE.gz"
      else
        log "  CSV export empty or failed; skipping upload + delete"
        rm -f "$AI_STAGE"
      fi
    else
      log "step: ai_calls archive — no rows older than $CUTOFF_DATE, nothing to archive"
    fi
  else
    log "WARN: could not compute 90-days-ago date (date -d / date -v failed); skipping ai_calls archive"
  fi
else
  log "WARN: ai_calls archive skipped (sqlite3 or SQLITE_SRC missing)"
fi

log "===== ats-archive run done ====="

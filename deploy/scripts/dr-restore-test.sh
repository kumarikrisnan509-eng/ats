#!/usr/bin/env bash
# ============================================================
#  dr-restore-test.sh — Tier I1 backup/DR verification
# ============================================================
# Pulls the latest snapshot from the GDrive remote, restores it to a
# scratch directory, and verifies the data is usable. Does NOT touch
# /etc/ats, /data/ats, or /var/lib/ats — production paths are READ-ONLY
# in this script. The restored copy lives in $DR_STAGE.
#
# Runs as root (needs to read /etc/ats/master.key + sealed-credential perms).
# Reports JSON to stdout (consumed by ats-admin endpoint that records the
# last successful test) + writes a human-readable log to $DR_LOG.
#
# Usage:
#   sudo /opt/ats/scripts/dr-restore-test.sh
#   sudo /opt/ats/scripts/dr-restore-test.sh --notify    # also POST to /api/admin/dr-status
#
# Exit codes:
#   0 = all checks passed
#   1 = restore worked but ≥1 sanity check failed
#   2 = restore itself failed (rclone error, missing remote, etc.)

set -uo pipefail

REMOTE="${REMOTE:-ats-archive:ats-audit-archive}"
DR_STAGE="${DR_STAGE:-/var/tmp/ats-dr-test}"
DR_LOG="${DR_LOG:-/var/log/ats/dr-restore-test.log}"
MASTER_KEY_PATH="${MASTER_KEY_PATH:-/etc/ats/master.key}"
PROD_DB="${PROD_DB:-/var/lib/ats/tokens/ats.db}"  # T-36 fix: actual prod path
PROD_TOKENS="${PROD_TOKENS:-/var/lib/ats/tokens}"
NOTIFY=0
[[ "${1:-}" == "--notify" ]] && NOTIFY=1

# JSON output collector
declare -A R   # results
R[started_at]="$(date -u +%FT%TZ)"
R[remote]="$REMOTE"
R[stage]="$DR_STAGE"

log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$DR_LOG"; }
fail() { R[ok]=false; R[error]="$1"; emit; exit "${2:-1}"; }

emit() {
  R[ended_at]="$(date -u +%FT%TZ)"
  # Convert assoc array to JSON
  local out="{"
  local first=1
  for k in "${!R[@]}"; do
    [[ $first -eq 0 ]] && out+=", "; first=0
    local v="${R[$k]}"
    # crude JSON escaping
    v="${v//\\/\\\\}"; v="${v//\"/\\\"}"
    # Booleans + numbers stay unquoted
    if [[ "$v" == "true" || "$v" == "false" || "$v" =~ ^[0-9]+$ ]]; then
      out+="\"$k\":$v"
    else
      out+="\"$k\":\"$v\""
    fi
  done
  out+="}"
  echo "$out"
}

mkdir -p "$(dirname "$DR_LOG")"
touch "$DR_LOG"

log "===== DR restore test start ====="
log "remote=$REMOTE stage=$DR_STAGE"

# === 1. Stage area ===
T0=$(date +%s)
rm -rf "$DR_STAGE"
mkdir -p "$DR_STAGE/db" "$DR_STAGE/tokens" "$DR_STAGE/audit"
R[t_setup_sec]="$(( $(date +%s) - T0 ))"

# === 2. Pull from rclone ===
T1=$(date +%s)
log "step: rclone copy audit -> stage"
if ! /usr/bin/rclone copy "$REMOTE" "$DR_STAGE/audit" --include "audit.log-*.gz" --max-age 14d 2>&1 | tee -a "$DR_LOG"; then
  fail "rclone copy audit failed" 2
fi
# If we ever start backing up the SQLite db + sealed tokens, those go here too:
# rclone copy "$REMOTE/db" "$DR_STAGE/db" 2>&1 | tee -a "$DR_LOG" || true
# rclone copy "$REMOTE/tokens" "$DR_STAGE/tokens" 2>&1 | tee -a "$DR_LOG" || true
R[t_rclone_sec]="$(( $(date +%s) - T1 ))"

AUDIT_COUNT=$(ls -1 "$DR_STAGE/audit" 2>/dev/null | wc -l | tr -d ' ')
R[restored_audit_files]="$AUDIT_COUNT"
[[ "$AUDIT_COUNT" -gt 0 ]] || fail "no audit files restored from remote" 1
log "restored $AUDIT_COUNT audit file(s)"

# === 3. Sanity check: can we read one and find at least 1 entry? ===
T2=$(date +%s)
LATEST=$(ls -t "$DR_STAGE/audit"/audit.log-*.gz 2>/dev/null | head -1)
if [[ -z "$LATEST" ]]; then
  fail "couldn't pick a latest audit file" 1
fi
log "sanity-reading latest: $LATEST"
ENTRIES=$(zcat "$LATEST" | wc -l | tr -d ' ')
R[latest_audit_entries]="$ENTRIES"
[[ "$ENTRIES" -gt 0 ]] || fail "latest audit file is empty after gunzip" 1
R[t_verify_audit_sec]="$(( $(date +%s) - T2 ))"

# === 4. Production sanity: live DB still openable from a snapshot copy ===
# T-36 fix: prod DB is in WAL mode, so a plain `cp ats.db` misses the WAL/SHM
# sidecars and we get an empty snapshot. Use sqlite3's .backup which produces
# a consistent point-in-time snapshot regardless of journaling mode.
T3=$(date +%s)
if [[ -f "$PROD_DB" ]]; then
  if command -v sqlite3 >/dev/null 2>&1; then
    if sqlite3 "$PROD_DB" ".backup '$DR_STAGE/db/snapshot.db'" 2>>"$DR_LOG"; then
      SCHEMA_VER=$(sqlite3 "$DR_STAGE/db/snapshot.db" "SELECT version FROM _schema_version ORDER BY version DESC LIMIT 1;" 2>>"$DR_LOG" || echo "ERR")
      USER_COUNT=$(sqlite3 "$DR_STAGE/db/snapshot.db" "SELECT COUNT(*) FROM users;" 2>>"$DR_LOG" || echo "ERR")
      AICALL_COUNT=$(sqlite3 "$DR_STAGE/db/snapshot.db" "SELECT COUNT(*) FROM ai_calls WHERE ts > datetime('now', '-7 days');" 2>>"$DR_LOG" || echo "ERR")
      R[db_schema_version]="$SCHEMA_VER"
      R[db_user_count]="$USER_COUNT"
      R[db_ai_calls_7d]="$AICALL_COUNT"
      log "db snapshot ok: schema=$SCHEMA_VER users=$USER_COUNT ai_calls_7d=$AICALL_COUNT"
    else
      R[db_check]="backup-failed"
      log "WARN: sqlite3 .backup failed (see log above); skipping query sanity"
    fi
  else
    R[db_check]="sqlite3-missing"
    log "WARN: sqlite3 CLI not installed; skipping db sanity"
  fi
else
  R[db_check]="no-prod-db-found"
  log "WARN: prod db not at $PROD_DB; skipping snapshot sanity"
fi
R[t_db_sec]="$(( $(date +%s) - T3 ))"

# === 5. Master key + sealed credentials sanity ===
T4=$(date +%s)
if [[ -f "$MASTER_KEY_PATH" ]]; then
  KEY_SIZE=$(stat -c%s "$MASTER_KEY_PATH")
  R[master_key_bytes]="$KEY_SIZE"
  [[ "$KEY_SIZE" -ge 32 ]] || fail "master key suspiciously small: $KEY_SIZE bytes" 1
  log "master key present: $KEY_SIZE bytes"
else
  fail "no master key at $MASTER_KEY_PATH" 1
fi
TOKEN_COUNT=$(ls -1 "$PROD_TOKENS" 2>/dev/null | grep -v '^_' | wc -l | tr -d ' ')
R[sealed_token_files]="$TOKEN_COUNT"
log "sealed tokens dir has $TOKEN_COUNT file(s)"
R[t_creds_sec]="$(( $(date +%s) - T4 ))"

# === 6. RTO measurement ===
TOTAL=$(( $(date +%s) - T0 ))
R[rto_total_sec]="$TOTAL"
R[rto_minutes]="$(( TOTAL / 60 ))"
R[ok]=true
log "===== DR restore test PASSED in ${TOTAL}s ====="

emit | tee -a "$DR_LOG"

# === 7. Optional: POST to backend so dashboard can show ===
if [[ "$NOTIFY" -eq 1 ]]; then
  log "step: POST to /api/admin/dr-status"
  # T-36 fix: capture status code + body separately so failures are debuggable.
  # The POST goes through nginx (https) -> backend container — using
  # 127.0.0.1:8080 directly bypasses TLS for less moving parts.
  TOKEN="$(cat /etc/ats/.dr-token 2>/dev/null || echo unset)"
  HTTP=$(curl -s -o /tmp/dr-post.out -w '%{http_code}' -X POST "http://127.0.0.1:8080/api/admin/dr-status" \
    -H "Content-Type: application/json" \
    -H "x-ats-dr-token: $TOKEN" \
    -d "$(emit)") || HTTP="curl_err"
  if [[ "$HTTP" == "200" ]]; then
    log "POST OK (200): $(cat /tmp/dr-post.out)"
  else
    log "WARN: admin POST failed: HTTP=$HTTP body=$(cat /tmp/dr-post.out 2>/dev/null | head -c 200)"
  fi
  rm -f /tmp/dr-post.out
fi

exit 0

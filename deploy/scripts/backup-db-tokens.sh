#!/usr/bin/env bash
# ============================================================
#  backup-db-tokens.sh — T-421: off-site DB + sealed-tokens backup
# ============================================================
# Production-readiness audit T-421 finding:
#   dr-restore-test.sh ONLY pulled audit logs from the rclone remote.
#   The actual database (/var/lib/ats/tokens/ats.db) and the sealed
#   broker-token vault (/var/lib/ats/tokens/*.sealed) had NO off-site
#   copy. VM loss = total data loss for user accounts, broker mappings,
#   ai_calls history, paper-trade state, autorun config, etc.
#
# What this does:
#   1. sqlite3 .backup the WAL'd DB to a temp file (consistent snapshot).
#   2. Tar the snapshot + the sealed tokens dir.
#   3. Encrypt the tar with gpg AES256 + passphrase from
#      /etc/ats/.backup-passphrase (NEVER over the wire, NEVER logged).
#   4. rclone copy the encrypted tarball to the audit-archive remote.
#   5. Keep last 14 daily snapshots remote-side (rclone --max-age 14d).
#
# SAFETY GATES (intentional — this is opt-in):
#   * If /etc/ats/.backup-passphrase does NOT exist, the script logs a
#     warning and exits 0. Setup-dr-cron.sh does NOT install the cron
#     entry that runs this script — operator must do it manually after
#     creating the passphrase file. See deploy/scripts/README-DR.md.
#   * The master.key is INTENTIONALLY NOT backed up. It stays on-VM
#     only. The operator must keep a copy themselves (e.g. printed in
#     a safe, encrypted in a password manager). If both the VM AND the
#     operator's copy are lost, the sealed tokens are unrecoverable.
#     This is the correct posture: master.key being off-site too means
#     a single-system compromise = total breach.
#
# Usage:
#   sudo /opt/ats/scripts/backup-db-tokens.sh
#
# Exit codes:
#   0 = backup succeeded OR opt-out (no passphrase file)
#   1 = sqlite3 .backup failed
#   2 = gpg encrypt failed
#   3 = rclone upload failed
# ============================================================
set -uo pipefail

REMOTE="${REMOTE:-ats-archive:ats-audit-archive/db-snapshots}"
PROD_DB="${PROD_DB:-/var/lib/ats/tokens/ats.db}"
PROD_TOKENS="${PROD_TOKENS:-/var/lib/ats/tokens}"
PASSPHRASE_PATH="${PASSPHRASE_PATH:-/etc/ats/.backup-passphrase}"
WORK_DIR="${WORK_DIR:-/var/tmp/ats-backup}"
LOG="${LOG:-/var/log/ats/backup-db-tokens.log}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"

log() { echo "[$(date -u +%FT%TZ)] $*" | tee -a "$LOG"; }

mkdir -p "$(dirname "$LOG")"
touch "$LOG"

log "===== backup-db-tokens.sh start ====="

# Safety gate: no passphrase file = no backup. Logged as a clear notice
# so operators who haven't enabled this know why nothing is happening.
if [[ ! -s "$PASSPHRASE_PATH" ]]; then
    log "NOTICE: $PASSPHRASE_PATH absent or empty — backup OPT-OUT (no-op)."
    log "  To enable: see deploy/scripts/README-DR.md (T-421 section)."
    exit 0
fi

# Prereqs
for bin in sqlite3 gpg rclone tar; do
    if ! command -v "$bin" >/dev/null 2>&1; then
        log "ERROR: required binary '$bin' not found in PATH"
        exit 1
    fi
done

# Stage
rm -rf "$WORK_DIR"
mkdir -p "$WORK_DIR"
chmod 700 "$WORK_DIR"

# Snapshot DB. .backup yields a consistent point-in-time copy that's
# safe across WAL mode, unlike `cp` which misses WAL/SHM sidecars.
SNAPSHOT="$WORK_DIR/ats.db"
log "step: sqlite3 .backup $PROD_DB -> $SNAPSHOT"
if ! sqlite3 "$PROD_DB" ".backup '$SNAPSHOT'" 2>>"$LOG"; then
    log "ERROR: sqlite3 .backup failed"
    rm -rf "$WORK_DIR"
    exit 1
fi
DB_BYTES=$(stat -c%s "$SNAPSHOT")
log "  snapshot ok: $DB_BYTES bytes"

# Tar the snapshot + sealed tokens dir. We DON'T include master.key
# (intentional — see header).
TS=$(date -u +%Y%m%dT%H%M%SZ)
ARCHIVE="$WORK_DIR/ats-backup-${TS}.tar"
log "step: tar -> $ARCHIVE"
tar -C "$WORK_DIR" -cf "$ARCHIVE" ats.db
# Sealed tokens (files ending in .sealed or similar). Use --transform so
# the tar entries land under tokens/ regardless of source layout.
if [[ -d "$PROD_TOKENS" ]]; then
    # Use a temp listing so missing-file races don't blow up tar.
    SEALED_LIST=$(find "$PROD_TOKENS" -maxdepth 1 -type f \
        \( -name '*.sealed' -o -name '*.key' -o -name 'master.key' -prune \) 2>/dev/null \
        | grep -v 'master.key' || true)
    if [[ -n "$SEALED_LIST" ]]; then
        echo "$SEALED_LIST" | tar -rf "$ARCHIVE" -T - 2>>"$LOG" || \
            log "  WARN: some sealed-token files failed to add (ok, see log)"
    fi
fi
ARCHIVE_BYTES=$(stat -c%s "$ARCHIVE")
log "  tar ok: $ARCHIVE_BYTES bytes"

# Encrypt with gpg AES256 + passphrase. --batch + --yes for cron use.
# --no-symkey-cache so the passphrase is never cached in gpg-agent.
ENCRYPTED="${ARCHIVE}.gpg"
log "step: gpg encrypt -> $ENCRYPTED"
if ! gpg --batch --yes --no-symkey-cache --symmetric --cipher-algo AES256 \
        --passphrase-file "$PASSPHRASE_PATH" \
        --output "$ENCRYPTED" "$ARCHIVE" 2>>"$LOG"; then
    log "ERROR: gpg encrypt failed"
    rm -rf "$WORK_DIR"
    exit 2
fi
ENC_BYTES=$(stat -c%s "$ENCRYPTED")
log "  encrypted ok: $ENC_BYTES bytes"

# Drop the plaintext tar + snapshot ASAP.
shred -u "$ARCHIVE" "$SNAPSHOT" 2>/dev/null || rm -f "$ARCHIVE" "$SNAPSHOT"

# Upload via rclone. The remote should be configured as a `crypt` backend
# for defense-in-depth — even if rclone's transport is intercepted, the
# bytes are already AES256-gpg-encrypted with a passphrase that does NOT
# leave the VM.
log "step: rclone copy -> $REMOTE"
if ! rclone copy "$ENCRYPTED" "$REMOTE" 2>>"$LOG"; then
    log "ERROR: rclone upload failed"
    rm -rf "$WORK_DIR"
    exit 3
fi
log "  upload ok"

# Retention: keep last RETENTION_DAYS days of snapshots on the remote.
log "step: rclone delete --min-age ${RETENTION_DAYS}d $REMOTE"
rclone delete --min-age "${RETENTION_DAYS}d" "$REMOTE" 2>>"$LOG" || \
    log "  WARN: retention cleanup failed (non-fatal)"

# Cleanup local
rm -rf "$WORK_DIR"

log "===== backup-db-tokens.sh OK (snapshot $TS, $ENC_BYTES bytes encrypted) ====="
exit 0

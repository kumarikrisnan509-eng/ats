#!/usr/bin/env bash
# ============================================================
#  setup-dr-cron.sh — T99-T36: one-time install for the DR
#  restore test cron + script + auth token.
#
#  Runs on the VM as root via sudo. Idempotent — safe to re-run.
#  After this, /api/health-deep stops reporting drStale:true.
#
#  Usage:
#    sudo bash deploy/scripts/setup-dr-cron.sh
#  or after deploy:
#    sudo /opt/ats/scripts/setup-dr-cron.sh
#
#  What it does:
#    1. Installs dr-restore-test.sh to /opt/ats/scripts/ (mode 0755)
#    2. Generates /etc/ats/.dr-token if absent (32-byte hex)
#    3. Writes /etc/cron.d/ats-dr-test (1st of month at 03:30 UTC)
#    4. Runs the test ONCE immediately so the alarm clears today
# ============================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: run as root (sudo bash $0)" >&2
  exit 1
fi

SCRIPT_DIR_SRC="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
SRC="${SCRIPT_DIR_SRC}/dr-restore-test.sh"
DEST_DIR="/opt/ats/scripts"
DEST="${DEST_DIR}/dr-restore-test.sh"
TOKEN_PATH="/etc/ats/.dr-token"
CRON_PATH="/etc/cron.d/ats-dr-test"
LOG_DIR="/var/log/ats"

echo "==> [1/4] install dr-restore-test.sh -> $DEST"
mkdir -p "$DEST_DIR" "$LOG_DIR" /etc/ats
# Resolve realpaths so a same-file copy is a no-op even if one side is a symlink
# or relative. Happens when this script is invoked from /opt/ats/scripts/ itself
# (the deploy workflow scps dr-restore-test.sh there alongside this one).
SRC_REAL="$(readlink -f "$SRC" 2>/dev/null || echo "$SRC")"
DEST_REAL="$(readlink -f "$DEST" 2>/dev/null || echo "$DEST")"
if [[ ! -f "$SRC" ]]; then
  if [[ -f "$DEST" ]]; then
    echo "    (source missing but $DEST already exists - keeping current)"
  else
    echo "ERROR: source script not found at $SRC" >&2
    exit 2
  fi
elif [[ "$SRC_REAL" == "$DEST_REAL" ]]; then
  echo "    (source and destination are the same file - already in place, skipping)"
  chmod 0755 "$DEST"
  chown root:root "$DEST"
else
  install -m 0755 -o root -g root "$SRC" "$DEST"
fi

echo "==> [2/4] ensure DR auth token at $TOKEN_PATH"
if [[ ! -s "$TOKEN_PATH" ]] || [[ "$(cat "$TOKEN_PATH" 2>/dev/null)" == "unset" ]]; then
  head -c 32 /dev/urandom | xxd -p | tr -d '\n' > "$TOKEN_PATH"
  echo "" >> "$TOKEN_PATH"
  echo "    generated new 32-byte token"
fi
# T-36 v3: always 0444 world-readable. v2 tried 0440 root:ats but the backend
# container's process isn't necessarily in group 987 (compose env_file reads
# backend.env from the host, the container process never directly reads it).
# The token is a single-purpose shared secret, not a key — world-readable on a
# single-user VM matches master.key's existing 0444 pattern. Reset every run
# so v1/v2 tokens get normalized.
chown root:root "$TOKEN_PATH"
chmod 0444 "$TOKEN_PATH"
echo "    perms set: root:root 0444 (world-readable, container can read)"

# Verify the backend container can actually open it now. If this fails we'll
# know before the test POST hits 401.
if command -v docker >/dev/null 2>&1; then
  if docker exec ats-backend test -r /etc/ats/.dr-token 2>/dev/null; then
    echo "    verified: ats-backend can read the token"
  else
    echo "    WARN: ats-backend cannot read the token (mount or perms issue)" >&2
  fi
fi

# Ensure sqlite3 CLI is installed so the DR test's DB sanity check actually
# runs (was silently skipping before with 'sqlite3-missing').
if ! command -v sqlite3 >/dev/null 2>&1; then
  echo "    installing sqlite3 CLI (for DR DB sanity check)..."
  DEBIAN_FRONTEND=noninteractive apt-get update -qq >/dev/null 2>&1 || true
  DEBIAN_FRONTEND=noninteractive apt-get install -y -qq sqlite3 >/dev/null 2>&1 \
    && echo "    sqlite3 installed" \
    || echo "    WARN: sqlite3 install failed — DB check will be skipped"
fi

# The backend container mounts /etc/ats:/etc/ats:ro (per T99-T36 compose change)
# so it reads the SAME token file the host script uses. No restart needed for a
# bind-mounted directory because new files appear immediately inside.

echo "==> [3/4] write monthly cron entry $CRON_PATH"
cat > "$CRON_PATH" <<'CRONEOF'
# T99-T36: monthly DR restore-test (Tier I1 cadence).
# 03:30 UTC on the 1st of every month = 09:00 IST.
# --notify POSTs the result to /api/admin/dr-status so /api/health-deep
# stops reporting drStale:true.
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 3 1 * * root /opt/ats/scripts/dr-restore-test.sh --notify >> /var/log/ats/dr-restore-test.log 2>&1
CRONEOF
chmod 0644 "$CRON_PATH"
systemctl reload cron 2>/dev/null || systemctl restart cron 2>/dev/null || true
echo "    cron entry written + cron reloaded"

echo "==> [4/4] run the test ONCE now so today's alarm clears"
if "$DEST" --notify; then
  echo "    DR test PASSED - /api/health-deep drStale should flip false within ~30s"
else
  rc=$?
  echo "WARN: DR test exited with $rc - see /var/log/ats/dr-restore-test.log" >&2
  echo "      The cron is still installed and will retry on the 1st."
fi

echo ""
echo "DONE. Verify with:"
echo "  curl -s https://ats.rajasekarselvam.com/api/health-deep | jq .checks.drStale"
echo "  ls -la /etc/cron.d/ats-dr-test"
echo "  cat /var/log/ats/dr-restore-test.log | tail -20"

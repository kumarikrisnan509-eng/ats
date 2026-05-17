#!/usr/bin/env bash
# ============================================================
#  repair-rclone-wrapper.sh — T99-T39 one-time install.
#
#  Installs the standalone ats-archive.sh wrapper (which fixes the SQLITE_SRC
#  path bug — old default /data/ats/ats.db doesn't exist on this VM; correct
#  path is /var/lib/ats/tokens/ats.db). Symlinks /usr/local/bin/ats-archive-audit.sh
#  to the new script so the existing cron entry keeps working.
#
#  Runs as root via sudo. Idempotent — safe to re-run.
#
#  Usage:
#    sudo /opt/ats/scripts/repair-rclone-wrapper.sh
#
#  After this, the nightly cron at 02:30 UTC will actually back up the SQLite
#  DB (not silently skip it) — verify the next morning with:
#    sudo rclone lsf ats-archive:ats-audit-archive/db/
# ============================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: run as root (sudo bash $0)" >&2
  exit 1
fi

SRC="/opt/ats/scripts/ats-archive.sh"
WRAPPER_LINK="/usr/local/bin/ats-archive-audit.sh"

echo "==> [1/3] verify standalone wrapper at $SRC"
if [[ ! -x "$SRC" ]]; then
  echo "ERROR: $SRC not found or not executable." >&2
  echo "       Has the latest deploy landed? Check: ls -la /opt/ats/scripts/ats-archive.sh" >&2
  exit 2
fi
echo "    OK: $SRC present ($(stat -c%s "$SRC") bytes)"

echo "==> [2/3] symlink $WRAPPER_LINK -> $SRC"
# If old wrapper exists as a real file, back it up before replacing with symlink.
if [[ -f "$WRAPPER_LINK" && ! -L "$WRAPPER_LINK" ]]; then
  cp -a "$WRAPPER_LINK" "$WRAPPER_LINK.bak-$(date +%s)"
  echo "    backed up old wrapper"
fi
ln -sf "$SRC" "$WRAPPER_LINK"
echo "    symlink set"

echo "==> [3/3] run one backup now to flush the gap"
if "$WRAPPER_LINK"; then
  echo ""
  echo "DONE. Verify with:"
  echo "  sudo rclone lsf ats-archive:ats-audit-archive/db/"
  echo "  sudo rclone lsf ats-archive:ats-audit-archive/tokens/"
  echo "  sudo tail -30 /var/log/ats-rclone.log"
else
  rc=$?
  echo "WARN: backup run exited $rc - see /var/log/ats-rclone.log for details" >&2
  echo "      The wrapper is still in place; nightly cron will retry at 02:30 UTC."
fi

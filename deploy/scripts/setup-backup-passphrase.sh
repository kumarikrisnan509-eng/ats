#!/usr/bin/env bash
# ============================================================
#  setup-backup-passphrase.sh — T-478 operator helper.
#
#  ONE-TIME setup for the off-site DR backup encryption passphrase.
#  Generates a 64-char passphrase at /etc/ats/.backup-passphrase
#  AND prints it ONCE so the operator can store a copy in their
#  password manager.
#
#  Without this passphrase saved offline, the encrypted backups in
#  rclone:ats-audit-archive/db-snapshots become UNRECOVERABLE if
#  the VM disk is lost. THAT IS THE EXACT FAILURE MODE THE DR
#  BACKUP IS MEANT TO PREVENT.
#
#  Usage:
#    sudo bash deploy/scripts/setup-backup-passphrase.sh
#  or after deploy:
#    sudo /opt/ats/scripts/setup-backup-passphrase.sh
#
#  Idempotent: refuses to overwrite if the file already exists.
#  To rotate, delete the file FIRST (and re-encrypt the rclone
#  archive with the new key, or accept that all old backups
#  become unrecoverable).
# ============================================================
set -euo pipefail

if [[ $EUID -ne 0 ]]; then
    echo "ERROR: run as root (sudo bash $0)" >&2
    exit 1
fi

PASSPHRASE_PATH="${PASSPHRASE_PATH:-/etc/ats/.backup-passphrase}"

mkdir -p "$(dirname "$PASSPHRASE_PATH")"

if [[ -s "$PASSPHRASE_PATH" ]]; then
    echo "ERROR: $PASSPHRASE_PATH already exists." >&2
    echo "" >&2
    echo "Rotating the passphrase makes ALL existing encrypted backups" >&2
    echo "in rclone:ats-audit-archive/db-snapshots UNRECOVERABLE." >&2
    echo "" >&2
    echo "If you really want to rotate:" >&2
    echo "  1. Save the OLD passphrase from your password manager" >&2
    echo "  2. Decrypt + re-encrypt any backups you still need" >&2
    echo "  3. Delete $PASSPHRASE_PATH" >&2
    echo "  4. Re-run this script" >&2
    exit 2
fi

# Generate a strong passphrase. 48 bytes -> 64 base64 chars, well
# above the 32-char minimum that GPG --batch needs to feel safe.
PASSPHRASE="$(head -c 48 /dev/urandom | base64 | tr -d '\n=' | head -c 64)"

# Write atomically. umask 077 + install protects against a race
# where a concurrent reader could glimpse the file mid-write.
umask 077
TMPFILE="$(mktemp --tmpdir=/etc/ats .backup-passphrase.XXXXXX)"
printf '%s\n' "$PASSPHRASE" > "$TMPFILE"
chown root:root "$TMPFILE"
chmod 0400 "$TMPFILE"
mv -f "$TMPFILE" "$PASSPHRASE_PATH"

echo "==============================================================="
echo "  BACKUP PASSPHRASE GENERATED"
echo "==============================================================="
echo ""
echo "  Path:      $PASSPHRASE_PATH (root:root 0400)"
echo "  Length:    64 chars (~384 bits of entropy)"
echo ""
echo "  THIS IS THE ONLY TIME THE PASSPHRASE IS DISPLAYED:"
echo ""
echo "    $PASSPHRASE"
echo ""
echo "  Copy it RIGHT NOW into:"
echo "    [ ] your password manager (1Password / Bitwarden / etc.)"
echo "    [ ] a printed sealed envelope in your safe (optional but recommended)"
echo "    [ ] a second offline location (operator-of-last-resort)"
echo ""
echo "  Without a saved copy, if this VM's disk is lost, every encrypted"
echo "  backup in rclone:ats-audit-archive/db-snapshots becomes unrecoverable."
echo ""
echo "  The DR backup cron will start using this passphrase on its"
echo "  next scheduled run (nightly via setup-rclone-archive.sh)."
echo "==============================================================="
echo ""
echo "Press ENTER once you have saved the passphrase. (Ctrl-C to abort"
echo "and re-run later.)"
read -r _ < /dev/tty

# Clear the displayed passphrase from terminal scrollback if possible.
# Best-effort -- xterm and most modern terminals honor this.
printf '\033[2J\033[H' || true

echo "Passphrase saved. The DR backup is now armed."
echo "Verify with: cat /etc/ats/.backup-passphrase >/dev/null && echo OK"

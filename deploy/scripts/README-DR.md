# Disaster Recovery (DR) — Operator Guide

Status: T-421 in-progress (backup script shipped, off-site enable is opt-in)

## What's backed up today

| Asset                              | Off-site? | How                                              |
| ---------------------------------- | --------- | ------------------------------------------------ |
| `/var/log/ats/audit/*.log.gz`      | YES       | hourly via `ats-archive.sh` → rclone GDrive      |
| `/var/lib/ats/tokens/ats.db`       | OPT-IN    | T-421: `backup-db-tokens.sh` (see below)         |
| `/var/lib/ats/tokens/*.sealed`     | OPT-IN    | T-421: same script                               |
| `/etc/ats/master.key`              | NEVER     | operator-managed (see "Master key" below)        |

## Tier I1 monthly restore test

`dr-restore-test.sh` runs on the 1st of every month at 03:30 UTC
(see `/etc/cron.d/ats-dr-test`). It:

1. Pulls the last 14 days of audit logs from the rclone remote and
   gunzips one as a sanity check.
2. **(T-421)** Pulls the last 7 days of off-site DB snapshots, decrypts
   with `/etc/ats/.backup-passphrase`, extracts, runs sanity queries.
   If no snapshot exists or the passphrase file is missing, the test
   logs `WARN` and continues — it does NOT fail.
3. Snapshots the LIVE prod DB (read-only) and runs the same queries
   to confirm prod is queryable.
4. Verifies `master.key` exists with reasonable size + counts the
   sealed-token files.

The result is POSTed to `/api/admin/dr-status` so `/api/health-deep`
can flip `drStale: false`.

## Enabling T-421 off-site DB+tokens backup (opt-in)

The backup script is intentionally opt-in because:

* It requires a passphrase that you (the operator) must choose and
  remember — losing the passphrase = losing the off-site backup.
* The encrypted tarball is uploaded to the SAME rclone remote that
  audit logs go to; you should review that remote's permissions
  before enabling.
* This is a real-money trading system: any change to disaster-recovery
  posture needs a deliberate go-decision.

### Steps to enable

1. **Pick a passphrase** with at least 80 bits of entropy. Example:
   ```bash
   head -c 24 /dev/urandom | base64
   ```
   Store it somewhere safe and OFF the VM (password manager, printed
   in a safe, etc.). If the VM dies, you'll need this passphrase to
   restore from the off-site backup.

2. **Install the passphrase on the VM**:
   ```bash
   sudo bash -c 'umask 077 && cat > /etc/ats/.backup-passphrase'
   # paste the passphrase, hit Ctrl-D
   sudo chmod 400 /etc/ats/.backup-passphrase
   sudo chown root:root /etc/ats/.backup-passphrase
   ```

3. **Dry-run the backup once** to confirm it works:
   ```bash
   sudo /opt/ats/scripts/backup-db-tokens.sh
   sudo tail -50 /var/log/ats/backup-db-tokens.log
   ```
   You should see a successful rclone upload at the end.

4. **Verify the round-trip** by running the DR restore test:
   ```bash
   sudo /opt/ats/scripts/dr-restore-test.sh
   ```
   You should see `db_remote_check: ok` and matching `db_remote_users`
   counts.

5. **Install the daily cron**:
   ```bash
   sudo tee /etc/cron.d/ats-db-backup > /dev/null <<'EOF'
   # T-421: daily DB + sealed-tokens off-site backup. 02:30 UTC = 08:00 IST.
   # Keeps last 14 days on the rclone remote.
   SHELL=/bin/bash
   PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
   30 2 * * * root /opt/ats/scripts/backup-db-tokens.sh >> /var/log/ats/backup-db-tokens.log 2>&1
   EOF
   sudo chmod 0644 /etc/cron.d/ats-db-backup
   sudo systemctl reload cron
   ```

## Master key

`master.key` is **never** uploaded off-site by automation. Reasoning:

* It seals all broker tokens. If both the VM and the off-site copy
  were compromised in the same incident, attacker gets the keys to
  every broker session.
* Keeping it on the VM only + a separate operator-managed copy
  (printed in a safe / encrypted in a password manager) preserves
  defense-in-depth.

**Operator MUST keep an off-VM copy of `/etc/ats/master.key`.**
Without it, the off-site sealed tokens are useless even after a
successful restore.

## Restore procedure (full VM loss)

1. Stand up a new VM with the same Ubuntu + docker baseline.
2. Restore `/etc/ats/master.key` from your operator-managed copy.
3. Restore `/etc/ats/.backup-passphrase` from your password manager.
4. Pull the latest encrypted snapshot from the rclone remote:
   ```bash
   rclone copy ats-archive:ats-audit-archive/db-snapshots /tmp/restore \
     --include "ats-backup-*.gpg" --max-age 24h
   ```
5. Decrypt and extract:
   ```bash
   ENC=$(ls -t /tmp/restore/ats-backup-*.gpg | head -1)
   gpg --batch --no-symkey-cache --decrypt \
       --passphrase-file /etc/ats/.backup-passphrase \
       --output /tmp/restore/ats-backup.tar "$ENC"
   sudo tar -xf /tmp/restore/ats-backup.tar -C /var/lib/ats/tokens/
   ```
6. Run the normal deploy → service comes up against the restored DB.
7. Run `dr-restore-test.sh` to confirm the restored copy passes
   sanity queries.

## Disable / pause T-421 backup

```bash
sudo rm /etc/cron.d/ats-db-backup
# Optionally also remove the passphrase so the script no-ops if invoked manually:
sudo shred -u /etc/ats/.backup-passphrase
```

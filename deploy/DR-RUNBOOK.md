# ATS — Disaster Recovery Runbook (Tier I1)

Last updated: 2026-05-17

## What this covers

Procedure for verifying that ATS is restorable from backup, and the recovery
steps to follow when production data is actually lost.

## Targets

| Metric | Target |
|---|---|
| RTO (recovery time objective) | < 1 hour |
| RPO (recovery point objective) | < 24 hours (nightly rclone runs at 02:30 UTC = 08:00 IST) |
| DR test cadence | Monthly (1st of each month) until Tier 3, then quarterly |

## What gets backed up today (T99-T39)

| Source | Target | Cron |
|---|---|---|
| `/var/log/ats/audit.log-*.gz` | `ats-archive:ats-audit-archive/audit/` | `/etc/cron.d/ats-audit-rclone` daily 02:30 UTC |
| `/var/lib/ats/tokens/ats.db` (WAL-safe `.backup`) | `ats-archive:ats-audit-archive/db/ats.db` | same cron |
| `/var/lib/ats/tokens/*` (sealed Zerodha tokens, ats.db excluded) | `ats-archive:ats-audit-archive/tokens/` | same cron |

The wrapper lives at `/opt/ats/scripts/ats-archive.sh` (auto-synced via the
deploy workflow). `/usr/local/bin/ats-archive-audit.sh` is a symlink to it
for cron compatibility.

To repair from an older deployment that was missing the DB+tokens backup
(old wrapper had wrong SQLITE_SRC default):

```bash
ssh ubuntu@141.148.192.4
sudo /opt/ats/scripts/repair-rclone-wrapper.sh
```

Idempotent — also runs a backup immediately so the gap is closed today.

## What is NOT backed up

| Source | Why it matters | Action |
|---|---|---|
| `/etc/ats/master.key` | libsodium key — without this, nothing decrypts | Off-site copy already exists locally (Windows BACKUP-CREDENTIALS.cmd). NOT backed up to GDrive deliberately — it would let anyone with GDrive access decrypt everything. |

## One-time setup (T99-T36)

Run this ONCE after first deploy or after a fresh VM rebuild. It installs the
script, generates the auth token, writes the monthly cron, and runs the test
once so `/api/health-deep` stops reporting `drStale:true`.

```bash
ssh ubuntu@141.148.192.4
sudo /opt/ats/scripts/setup-dr-cron.sh
```

Idempotent — safe to re-run. The deploy workflow keeps both
`dr-restore-test.sh` and `setup-dr-cron.sh` synced to `/opt/ats/scripts/` on
every push, so future code changes to the test logic land automatically.

## Monthly test procedure (automated)

After the one-time setup, the test runs on its own:

```
30 3 1 * *   /opt/ats/scripts/dr-restore-test.sh --notify
```

= 03:30 UTC on the 1st of every month = 09:00 IST. To run it manually any time:

```bash
sudo /opt/ats/scripts/dr-restore-test.sh --notify
```

The script writes JSON to `/var/log/ats/dr-restore-test.log` and, with
`--notify`, POSTs the result to `/api/admin/dr-status` so the AI providers
screen + `/api/health-deep` can flag when the last test was > 30 days ago.

### Expected output

```json
{
  "ok": true,
  "rto_total_sec": 35,
  "restored_audit_files": 7,
  "latest_audit_entries": 1240,
  "db_user_count": 1,
  "db_ai_calls_7d": 18,
  "master_key_bytes": 32
}
```

### Failure paths

| Symptom | Likely cause | Fix |
|---|---|---|
| `rclone copy audit failed` | rclone OAuth token revoked | `sudo rclone config reconnect ats-archive:` |
| `no audit files restored` | logrotate stopped firing | Check `/etc/cron.d/ats-audit`; check logrotate status |
| `latest audit file is empty` | logrotate ran but copytruncate missed the rotation window | Add `prerotate` hook to backend; for now, rerun after the next rotation |
| `no master key at /etc/ats/master.key` | Disk wipe or new VM | Restore from local Windows backup; refer to BACKUP-CREDENTIALS.cmd output |
| `sqlite3 CLI not installed` | Stock Ubuntu | `sudo apt-get install -y sqlite3` |

## Full disaster recovery (production data lost)

If the VM is unrecoverable, follow these steps to stand up a replacement:

1. **Provision a new Ubuntu 24.04 ARM64 VM** with the same firewall rules
   (22, 80, 443 inbound).
2. **DNS swap**: update Hostinger A-record for `ats.rajasekarselvam.com` to
   the new IPv4. TTL is 5 minutes; users see <5 min downtime.
3. **Run bootstrap**: `deploy/scripts/bootstrap-vm.sh` installs Docker + nginx
   + ufw, requests Let's Encrypt cert.
4. **Restore master key**: copy `master.key` from local Windows backup to
   `/etc/ats/master.key` (mode 0440, owner root:ats).
5. **Restore SQLite**: copy latest GDrive snapshot to `/data/ats/ats.db`.
   (Once the wrapper backs this up — see "NOT backed up yet" above.)
6. **Restore sealed tokens**: copy `/var/lib/ats/tokens/` from GDrive snapshot.
7. **Set env**: copy `/etc/ats/backend.env` from local backup
   (BACKUP-CREDENTIALS.cmd output).
8. **Start container**: `cd /opt/ats/compose && docker compose up -d`.
9. **Verify**: `curl https://ats.rajasekarselvam.com/api/health-deep`.
10. **Re-OAuth Kite if needed**: `sudo /opt/ats/scripts/auto-login-host.js`
    (or wait for the 06:10 IST cron).
11. **Smoke-test 3 endpoints**: `/api/me/ai-keys`, `/api/me/portfolio/holdings`,
    `/api/scanner/history`.
12. **Backfill audit**: there will be a gap from last successful rclone run
    to now. Acceptable; users see "audit incomplete" banner until next
    rotation catches up.

## On-call expectations (Tier 2+ only)

When beta users exist:
- Slack/Telegram channel `#ats-incidents` for status updates
- 1-hour acknowledge SLO during market hours (09:15–15:30 IST Mon–Fri)
- 4-hour acknowledge SLO off-hours
- Post-incident postmortem within 72 hours

(Not in place yet — single user, no SLOs.)

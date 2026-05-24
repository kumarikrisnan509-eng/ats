# deploy/scripts/MANIFEST.md

Inventory of every script under `deploy/scripts/`. Generated for the architecture audit (T-355 finding #8). Update when adding or removing scripts.

**Maintenance rule:** if you add a script, add a row here. If you remove a script, remove its row. CI doesn't enforce this (yet) — it's social.

**Legend:**
- `Windows (PowerShell)` — runs from the operator's Windows laptop
- `Linux / VM (bash)` — runs on the Oracle Cloud Ubuntu VM
- `systemd service unit` — installed on the VM under /etc/systemd/system/
- `Node.js (runtime)` — runs on the VM as a Node process (cron or daemon)
- `Python (CI helper)` — runs inside the GitHub Actions runner

---

## Windows (PowerShell) (26)

| Script | Purpose |
|---|---|
| `analyze-vm.ps1` | _(undocumented — open the file for context)_ |
| `audit-and-fix-cron.ps1` | ============ INVENTORY ============ |
| `backup-credentials.ps1` | ============================================================ |
| `bootstrap-vm.ps1` | bootstrap-vm.ps1 - one-shot VM bootstrap for the ATS Docker deploy. |
| `cleanup-old-images.ps1` | ============================================================ |
| `cleanup-stale-cron.ps1` | _(undocumented — open the file for context)_ |
| `deploy-alerts.ps1` | T-190 redaction (P0 #1 from SECRETS-AUDIT.md): rotated; literal removed from repo. |
| `deploy-state-backup.ps1` | _(undocumented — open the file for context)_ |
| `deploy.ps1` | ============================================================ |
| `diag-new-image.ps1` | _(undocumented — open the file for context)_ |
| `diag-zerodha-start.ps1` | _(undocumented — open the file for context)_ |
| `enable-and-test-archive.ps1` | 1. Activate cron (move .disabled out of the way) |
| `force-login.ps1` | _(undocumented — open the file for context)_ |
| `gh-commit.ps1` | gh-commit.ps1 -- commit + push files via GitHub REST API. |
| `install-telegram-creds.ps1` | _(undocumented — open the file for context)_ |
| `remove-legacy-ats-files.ps1` | _(undocumented — open the file for context)_ |
| `secrets.local.example.ps1` | SAMPLE FILE -- do NOT commit secrets.local.ps1 itself (it is gitignored). |
| `set-zerodha-env.ps1` | Zerodha Kite Connect credentials (created 13 May 2026, ATS Cockpit app, ARS209) |
| `setup-autologin.ps1` | Embedded credentials (gitignored file) |
| `setup-rclone-archive.ps1` | Strip CRLF -> LF before shipping (Windows-edited bash scripts trip on \r) |
| `stop-and-cool-down.ps1` | _(undocumented — open the file for context)_ |
| `test-everything.ps1` | _(undocumented — open the file for context)_ |
| `test-vm-via-ssh.ps1` | Strip CRLF to LF before shipping |
| `update-nginx-prod.ps1` | Tier 15: push a hardened nginx site config for ats.rajasekarselvam.com. |
| `wire-zerodha-fully.ps1` | Zerodha Kite Connect credentials |
| `wire-zerodha-properly.ps1` | Zerodha Kite Connect credentials — correct env var names per zerodha-broker.js |

## Linux / VM (bash) (22)

| Script | Purpose |
|---|---|
| `ats-archive.sh` | ============================================================ |
| `check-disk.sh` | check-disk.sh -- run from cron every 15 minutes on the VM. |
| `check-email-deliverability.sh` | check-email-deliverability.sh — verify SPF / DKIM / DMARC DNS records. |
| `deploy-on-vm.sh` | deploy-on-vm.sh — runs ON the Oracle Cloud VM, invoked by GitHub Actions over SSH. |
| `deploy.sh` | deploy.sh |
| `dr-restore-test.sh` | ============================================================ |
| `gh-commit.sh` | gh-commit.sh -- commit + push files via GitHub REST API. |
| `gh-poll.sh` | gh-poll.sh -- wait for CI + deploy of a specific commit SHA, then verify health. |
| `install-zerodha-creds.sh` | install-zerodha-creds.sh |
| `morning-check.sh` | morning-check.sh |
| `repair-rclone-wrapper.sh` | ============================================================ |
| `rollback-on-vm.sh` | rollback-on-vm.sh -- T-201 (CODE-AUDIT E.11 #5): operator-friendly manual rollback. |
| `setup-all.sh` | ============================================================ |
| `setup-auto-login-cron.sh` | ============================================================ |
| `setup-auto-login-daemon.sh` | Tier 79: install the host-side auto-login daemon on the Oracle Cloud VM. |
| `setup-dr-cron.sh` | ============================================================ |
| `setup-oracle-linux-docker.sh` | setup-oracle-linux-docker.sh |
| `setup-oracle-linux.sh` | setup-oracle-linux.sh |
| `setup-rclone-archive.sh` | ============================================================ |
| `setup-ubuntu-docker.sh` | setup-ubuntu-docker.sh |
| `sync-nginx-config.sh` | ============================================================ |
| `vm-test.sh` | Runs ON the VM (shipped via scp). Pure bash to avoid PS->SSH->bash quoting issues. |

## Node.js (runtime) (5)

| Script | Purpose |
|---|---|
| `auto-login-daemon.js` | auto-login-daemon.js -- Tier 79: host-side Playwright headless Kite-login worker. |
| `auto-login-host.js` | auto-login-host.js (Tier 30.1) -- runs on the VM HOST (not in container). |
| `bulk-rotate-helpers.js` | bulk-rotate-helpers.js — pure-logic helpers extracted from bulk-rotate.js |
| `bulk-rotate.js` | bulk-rotate.js — daily per-user Kite token rotation. |
| `rotate-master-key.js` | T-210 (CODE-AUDIT E.4): rotate the libsodium master key. |

## systemd service unit (1)

| Script | Purpose |
|---|---|
| `ats-auto-login-daemon.service` | _(undocumented — open the file for context)_ |

## Python (CI helper) (1)

| Script | Purpose |
|---|---|
| `check-require-order.py` | _(undocumented — open the file for context)_ |

## Other (1)

| Script | Purpose |
|---|---|
| `systemd` | _(undocumented — open the file for context)_ |

---

## Audit notes (from T-355)

The audit flagged several issues with this directory:
- Two parallel deploy scripts (`deploy.ps1` + `deploy.sh`) that do the same thing — operator preference will pick one and the other should be deleted (separate ticket).
- A pile of `diag-*.ps1` debug scripts that were one-shot incident artifacts — candidates for deletion or archive.
- `gh-commit.ps1`/`gh-commit.sh` predate the Git Database API push pattern used by the auto-fix loop; verify they're still called before deletion.

These cleanups are out of scope for T-382 (this MANIFEST is the documentation half of the cleanup). See backlog T-383+.

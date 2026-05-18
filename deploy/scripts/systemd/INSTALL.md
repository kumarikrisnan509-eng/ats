# Installing the bulk-rotate timer on the VM host

One-time setup; takes ~5 min. Run as `deployer` on the Oracle VM.

```sh
# 1. Make sure /opt/ats/scripts/ exists and the script is in place.
sudo mkdir -p /opt/ats/scripts
sudo chown deployer:deployer /opt/ats/scripts
cd /opt/ats/scripts

# Copy bulk-rotate.js from the repo (deployer's checkout assumed at /home/deployer/ats).
cp /home/deployer/ats/deploy/scripts/bulk-rotate.js .

# 2. Install the three npm deps (playwright + otplib + node-fetch).
cat > package.json <<'EOF'
{
  "name": "ats-bulk-rotate",
  "version": "1.0.0",
  "private": true,
  "dependencies": {
    "playwright": "^1.49.0",
    "otplib": "^12.0.1",
    "node-fetch": "^2.7.0"
  }
}
EOF
npm install
npx playwright install --with-deps chromium   # downloads Chromium + system libs

# 3. Drop the systemd units.
sudo cp /home/deployer/ats/deploy/scripts/systemd/ats-bulk-rotate.service /etc/systemd/system/
sudo cp /home/deployer/ats/deploy/scripts/systemd/ats-bulk-rotate.timer   /etc/systemd/system/

# 4. Ensure the log directory exists and is writable.
sudo mkdir -p /var/log/ats
sudo chown deployer:deployer /var/log/ats

# 5. Reload + enable + start the timer.
sudo systemctl daemon-reload
sudo systemctl enable --now ats-bulk-rotate.timer

# 6. Verify.
systemctl list-timers ats-bulk-rotate.timer
# → next: Mon 2026-05-19 00:15:00 UTC  (05:45 IST)

# 7. Smoke-test manually (does NOT wait for the timer).
sudo systemctl start ats-bulk-rotate.service
journalctl -u ats-bulk-rotate.service --since "5 min ago" --no-pager
tail -n 50 /var/log/ats/bulk-rotate.log
```

## How to check it ran overnight

```sh
# Show the last 3 runs of the timer.
journalctl -u ats-bulk-rotate.service -n 200 --no-pager | grep '\[bulk-rotate\]'

# Or look at the dedicated log.
tail -n 100 /var/log/ats/bulk-rotate.log
```

You should see lines like:

```
[bulk-rotate] starting at 2026-05-19T00:15:43.121Z against http://127.0.0.1:8080
[bulk-rotate] 3 eligible account(s); 0 unseal error(s)
[u_abc/ARS209] OK
[u_def/ABC123] OK
[u_xyz/QWE456] OK
[bulk-rotate] done: 3 OK, 0 FAIL, 0 skipped
```

## Disabling the timer (e.g. during incidents)

```sh
sudo systemctl stop ats-bulk-rotate.timer
sudo systemctl disable ats-bulk-rotate.timer
```

The existing in-container `cron-reauth.js` continues to run as before
(T-114 retry chain + T-116 multi-window) — the host bulk-rotate is
strictly additive scaffolding for users who want their own auto-reauth
without sharing the operator's `/etc/ats/master.key`.

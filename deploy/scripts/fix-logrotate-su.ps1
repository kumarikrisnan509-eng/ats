param(
    [string]$VMHost = "141.148.192.4",
    [string]$VMUser = "ubuntu",
    [string]$SshKey = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key"
)
$ErrorActionPreference = "Continue"

function Section($title, $cmd) {
    "" | Out-Host
    Write-Host "============================================================" -ForegroundColor Cyan
    Write-Host " $title" -ForegroundColor Cyan
    Write-Host "============================================================" -ForegroundColor Cyan
    $output = ssh -i $SshKey "$VMUser@$VMHost" "$cmd" 2>&1
    $output | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
}

# Patch the logrotate config to drop privileges to ats:ats.
# /var/log/ats is mode 1777 by design (container UID mismatch), so logrotate's
# safety check needs an explicit su directive.
Section "Patch /etc/logrotate.d/ats-audit (use 'su root root')" @"
sudo tee /etc/logrotate.d/ats-audit > /dev/null <<'EOF'
# /var/log/ats is mode 1777 (Docker container UID mismatch).
# audit.log is owned by the container's UID (varies), so we need
# root privileges to read/copytruncate it. 'su root root' also
# tells logrotate to skip its world-writable safety check.
/var/log/ats/audit.log {
    su root root
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    copytruncate
    create 0644 root root
    dateext
    dateformat -%Y-%m-%d
}
EOF
echo '--- /etc/logrotate.d/ats-audit ---'
cat /etc/logrotate.d/ats-audit
"@

Section "Validate logrotate config (debug mode, no actual rotation)" @"
sudo logrotate --debug /etc/logrotate.d/ats-audit 2>&1 | head -40
"@

Section "Force-rotate audit log (real this time)" @"
sudo logrotate --force /etc/logrotate.d/ats-audit &&
echo '--- /var/log/ats/ after rotate ---' &&
ls -lah /var/log/ats/
"@

Section "Verify rotation produced a dated file" @"
ls /var/log/ats/audit.log-* 2>/dev/null && echo 'OK rotated file present' || echo 'WARNING no rotated file'
"@

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  logrotate fix applied + first rotation done." -ForegroundColor Green
Write-Host "  Daily cron at 02:30 UTC will pick up rotated .gz files." -ForegroundColor Green
Write-Host "  (First .gz appears tomorrow due to 'delaycompress'.)" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

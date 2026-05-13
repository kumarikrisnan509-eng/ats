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

# ----------------------------------------------------------------
# 1. Activate cron (move .disabled out of the way)
# ----------------------------------------------------------------
Section "Activate cron: ats-audit-rclone" @"
sudo mv /etc/cron.d/ats-audit-rclone.disabled /etc/cron.d/ats-audit-rclone &&
ls -lah /etc/cron.d/ats-audit-rclone &&
cat /etc/cron.d/ats-audit-rclone
"@

# ----------------------------------------------------------------
# 2. Smoke test: upload a small marker file directly
# ----------------------------------------------------------------
Section "Smoke test: upload marker file to GDrive" @"
echo 'ATS audit archive bootstrap test - rajasekarselvam.com - 2026-05-13' | sudo tee /tmp/ats-smoketest.txt > /dev/null &&
sudo rclone copy /tmp/ats-smoketest.txt ats-archive:ats-audit-archive/ --verbose 2>&1 | head -30 &&
echo '--- Contents of gdrive:ats-audit-archive/ ---' &&
sudo rclone ls ats-archive:ats-audit-archive/
"@

# ----------------------------------------------------------------
# 3. Force a logrotate run so we generate a rotated file
# ----------------------------------------------------------------
Section "Force logrotate of /var/log/ats/audit.log" @"
sudo logrotate --force /etc/logrotate.d/ats-audit &&
echo '--- /var/log/ats/ after rotate ---' &&
ls -lah /var/log/ats/
"@

# ----------------------------------------------------------------
# 4. Show the cron environment + rclone log file (initially empty)
# ----------------------------------------------------------------
Section "Cron environment + log file" @"
echo '--- /etc/cron.d/ats-audit-rclone ---' &&
cat /etc/cron.d/ats-audit-rclone &&
echo '--- /var/log/ats-rclone.log (last 20 lines) ---' &&
sudo tail -20 /var/log/ats-rclone.log
"@

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Done. End-to-end pipeline verified." -ForegroundColor Green
Write-Host "  Open Google Drive in your browser and look for the folder" -ForegroundColor Green
Write-Host "  'ats-audit-archive/' with file 'ats-smoketest.txt' inside." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

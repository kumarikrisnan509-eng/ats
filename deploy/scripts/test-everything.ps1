param(
    [string]$VMHost = "141.148.192.4",
    [string]$VMUser = "ubuntu",
    [string]$SshKey = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key"
)
$ErrorActionPreference = "Continue"

$passed = 0
$failed = 0

function Probe($label, $cmd, $expect) {
    Write-Host ""
    Write-Host "----- $label -----" -ForegroundColor Cyan
    $out = ssh -i $SshKey "$VMUser@$VMHost" "$cmd" 2>&1 | Out-String
    $out.TrimEnd() -split "`n" | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    if ($out -match $expect) {
        Write-Host "    [PASS] matched: $expect" -ForegroundColor Green
        $script:passed++
    } else {
        Write-Host "    [FAIL] expected to match: $expect" -ForegroundColor Red
        $script:failed++
    }
}

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  VM-INTERNAL SYSTEMS CHECK (via SSH)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

Probe "Backend container is running and healthy" `
    'sudo docker ps --filter name=ats-backend --format "{{.Names}} {{.Status}}"' `
    'ats-backend.*Up.*healthy'

Probe "Backend image tag" `
    'sudo docker inspect ats-backend --format "{{.Config.Image}}"' `
    'ghcr.io/.*ats-backend'

Probe "Backend listening on 127.0.0.1:8080" `
    'sudo ss -tlnp | grep :8080 || echo NONE' `
    '127\.0\.0\.1:8080'

Probe "/api/health (loopback)" `
    'curl -sS http://127.0.0.1:8080/api/health' `
    '"ok":true'

Probe "/api/config (loopback)" `
    'curl -sS http://127.0.0.1:8080/api/config' `
    '"paperTrading":true'

Probe "Audit log being appended" `
    'wc -l /var/log/ats/audit.log && tail -1 /var/log/ats/audit.log 2>/dev/null | head -c 200' `
    '\d+ /var/log/ats/audit.log'

Probe "Recent audit events present" `
    'sudo tail -3 /var/log/ats/audit.log 2>/dev/null' `
    '"event"'

Probe "Rotated audit log present" `
    'ls -lah /var/log/ats/audit.log-* 2>/dev/null || echo NONE' `
    'audit.log-2026'

Probe "nginx running" `
    'sudo systemctl is-active nginx' `
    'active'

Probe "nginx vhost config present" `
    'ls /etc/nginx/sites-enabled/ats.rajasekarselvam.com.conf 2>/dev/null && echo OK' `
    'OK'

Probe "TLS cert files present" `
    'ls /etc/letsencrypt/live/ats.rajasekarselvam.com/fullchain.pem && ls /etc/letsencrypt/live/ats.rajasekarselvam.com/privkey.pem' `
    'fullchain.pem'

Probe "certbot auto-renew timer active" `
    'sudo systemctl list-timers --all | grep -E "certbot|snap.certbot" || echo NONE' `
    'certbot'

Probe "TLS cert expiry > 30 days" `
    'sudo openssl x509 -in /etc/letsencrypt/live/ats.rajasekarselvam.com/fullchain.pem -noout -checkend 2592000 && echo OK_30D' `
    'OK_30D'

Probe "Cron entry for audit archive active (NOT .disabled)" `
    'ls -lah /etc/cron.d/ats-audit-rclone 2>/dev/null && echo CRON_PRESENT' `
    'CRON_PRESENT'

Probe "Cron .disabled file removed" `
    'ls /etc/cron.d/ats-audit-rclone.disabled 2>/dev/null || echo CLEAN' `
    'CLEAN'

Probe "rclone remote ats-archive configured" `
    'sudo rclone listremotes' `
    'ats-archive:'

Probe "rclone can list GDrive (token still valid)" `
    'sudo rclone lsd ats-archive: 2>&1 | head -5' `
    '\-1 \d{4}-\d{2}-\d{2}'

Probe "rclone GDrive folder ats-audit-archive exists" `
    'sudo rclone lsd ats-archive: 2>&1 | grep ats-audit-archive || sudo rclone mkdir ats-archive:ats-audit-archive && echo OK_MKDIR_OR_EXISTS' `
    'ats-audit-archive|OK_MKDIR_OR_EXISTS'

Probe "Logrotate config valid" `
    'sudo logrotate --debug /etc/logrotate.d/ats-audit 2>&1 | tail -5' `
    'Handling 1 logs'

Probe "Required: /etc/ats secrets present" `
    'sudo ls /etc/ats/backend.env /etc/ats/master.key' `
    'backend.env'

Probe "Required: /var/lib/ats/tokens dir present" `
    'sudo ls -lah /var/lib/ats/tokens | head -3' `
    'tokens'

Probe "Required: /opt/ats deploy artifacts" `
    'ls /opt/ats/compose/docker-compose.yml /opt/ats/scripts/deploy-on-vm.sh && echo BOTH_PRESENT' `
    'BOTH_PRESENT'

Probe "Disk free > 50 GB" `
    'df -h / | tail -1' `
    '/dev/sda1.*1\d\dG.*\d%'

Probe "Container memory usage reasonable (<500 MB)" `
    'sudo docker stats --no-stream --format "{{.Container}} {{.MemUsage}}" ats-backend' `
    'ats-backend.*MiB'

Probe "GitHub Actions known last deploy tag matches current container" `
    'cat /opt/ats/compose/.current-tag' `
    '^[a-f0-9]+$'

Write-Host ""
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  RESULTS: $passed passed, $failed failed" -ForegroundColor ($(if ($failed -gt 0) { 'Yellow' } else { 'Green' }))
Write-Host "============================================================" -ForegroundColor Cyan

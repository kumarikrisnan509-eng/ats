param(
    [string]$VMHost = "141.148.192.4",
    [string]$VMUser = "ubuntu",
    [string]$SshKey = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key"
)
$ErrorActionPreference = "Continue"

$bashScript = @'
#!/usr/bin/env bash
set -euo pipefail

echo "==> Verify env file has BROKER=zerodha + KITE_* keys"
sudo grep -E '^(BROKER|KITE_)' /etc/ats/backend.env | sed 's/\(KITE_API_SECRET=\).*/\1****REDACTED****/'

echo
echo "==> docker compose down (full stop)"
cd /opt/ats/compose
sudo docker compose --env-file /opt/ats/compose/.env down

echo
echo "==> docker compose up -d (fresh start, re-reads env_file)"
sudo docker compose --env-file /opt/ats/compose/.env up -d

echo
echo "==> Wait 10s for boot"
sleep 10

echo
echo "==> /api/health response:"
curl -sS http://127.0.0.1:8080/api/health | python3 -m json.tool

echo
echo "==> Container status:"
sudo docker ps --filter name=ats-backend --format 'table {{.Image}}\t{{.Status}}\t{{.Ports}}'

echo
echo "==> Backend startup log (last 30 lines):"
sudo docker logs --tail 30 ats-backend 2>&1
'@

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Force-recreate ats-backend to re-read env_file" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$bashScript | ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | ForEach-Object {
    Write-Host "    $_" -ForegroundColor DarkGray
}

Write-Host ""
Write-Host "Check above: broker.name should now be 'zerodha'" -ForegroundColor Green

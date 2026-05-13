param(
    [string]$VMHost = "141.148.192.4",
    [string]$VMUser = "ubuntu",
    [string]$SshKey = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key"
)
$ErrorActionPreference = "Continue"

$bashScript = @'
#!/usr/bin/env bash
set -uo pipefail

echo "==> Current /etc/ats/master.key perms:"
sudo ls -la /etc/ats/master.key

echo
echo "==> chmod 0444 (container ats user has different GID than host ats group, so needs world-r):"
sudo chmod 0444 /etc/ats/master.key
sudo ls -la /etc/ats/master.key

echo
echo "==> Restart container (compose up -d --force-recreate to pick up file):"
cd /opt/ats/compose
sudo docker compose --env-file /opt/ats/compose/.env down 2>&1 | tail -3
sudo docker compose --env-file /opt/ats/compose/.env up -d 2>&1

echo
echo "  waiting 12s..."
sleep 12

echo
echo "==> /api/health:"
curl -sS --max-time 5 http://127.0.0.1:8080/api/health
echo
echo
echo "==> Container running image:"
sudo docker inspect ats-backend --format '{{.Config.Image}}' 2>&1
echo
echo "==> Last 20 log lines:"
sudo docker logs --tail 20 ats-backend 2>&1
'@

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$OutFile     = Join-Path $ProjectRoot "deploy\.fix-masterkey-output.txt"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Fix master.key perms + restart container" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$bashScript | ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object {
    Write-Host "    $_" -ForegroundColor DarkGray
}

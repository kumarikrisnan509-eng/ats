param(
    [string]$VMHost = "141.148.192.4",
    [string]$VMUser = "ubuntu",
    [string]$SshKey = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key"
)
$ErrorActionPreference = "Continue"

$bashScript = @'
#!/usr/bin/env bash

echo "==> Container status (running or exited?)"
sudo docker ps -a --filter name=ats-backend --format 'table {{.Names}}\t{{.Status}}\t{{.RunningFor}}\t{{.ExitCode}}'

echo
echo "==> Backend logs (last 80 lines):"
sudo docker logs --tail 80 ats-backend 2>&1

echo
echo "==> Master key inside container?"
sudo docker exec ats-backend sh -c "ls -lah /etc/ats/master.key 2>&1; head -c 4 /etc/ats/master.key 2>&1 | xxd | head -1"

echo
echo "==> backend.env env vars seen by container process:"
sudo docker exec ats-backend sh -c "env | grep -E '^(BROKER|KITE_|ENV_|KILL_)' | sed 's/\\(KITE_API_SECRET=\\).*/\\1****REDACTED****/'"

echo
echo "==> Container process tree:"
sudo docker exec ats-backend sh -c "ps -ef 2>/dev/null || ps aux 2>/dev/null" | head -20

echo
echo "==> Listen sockets inside container:"
sudo docker exec ats-backend sh -c "ss -tlnp 2>/dev/null || netstat -tlnp 2>/dev/null" | head -10

echo
echo "==> Recent audit log entries (ZerodhaBroker errors?):"
sudo tail -15 /var/log/ats/audit.log
'@

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Diagnosing ats-backend startup with BROKER=zerodha" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$bashScript | ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | ForEach-Object {
    Write-Host "    $_" -ForegroundColor DarkGray
}

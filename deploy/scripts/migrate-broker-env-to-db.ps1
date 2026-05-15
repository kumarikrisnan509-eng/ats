param(
    [string]$VMHost = "141.148.192.4",
    [string]$VMUser = "ubuntu",
    [string]$SshKey = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key",
    [int]$UserId = 0,
    [switch]$DryRun
)
$ErrorActionPreference = "Continue"

Write-Host "Tier 57: migrating env Zerodha creds into broker_accounts row in DB..." -ForegroundColor Cyan
if ($DryRun) { Write-Host "  (DRY RUN -- no DB writes)" -ForegroundColor Yellow }

$userArg = if ($UserId -gt 0) { "--user-id $UserId" } else { "" }
$dryArg  = if ($DryRun) { "--dry-run" } else { "" }

$bashScript = @"
set +e
set -u

echo "==> [1] which user_id is admin?"
sudo docker exec ats-backend node -e "
const { open } = require('/app/db');
const db = open();
const r = db._conn.prepare('SELECT id, email, is_admin FROM users ORDER BY id').all();
console.table(r);
" 2>&1 | sed 's/^/    /'

echo
echo "==> [2] run migration"
sudo docker exec ats-backend node /app/migrate-env-broker-to-db.js $userArg $dryArg 2>&1 | sed 's/^/    /'

echo
echo "==> [3] verify broker_accounts row"
sudo docker exec ats-backend node -e "
const { open } = require('/app/db');
const db = open();
const r = db._conn.prepare('SELECT id, user_id, broker, broker_user_id, is_default, (api_key IS NOT NULL) as has_key, (access_token IS NOT NULL) as has_tok FROM broker_accounts').all();
console.table(r);
" 2>&1 | sed 's/^/    /'
"@

$bytes = [System.Text.Encoding]::UTF8.GetBytes($bashScript)
$b64 = [Convert]::ToBase64String($bytes)
$remoteCmd = "echo $b64 | base64 -d | bash"
& ssh -i $SshKey -o StrictHostKeyChecking=accept-new "$VMUser@$VMHost" $remoteCmd 2>&1 | ForEach-Object { Write-Host $_ -ForegroundColor DarkGray }

Write-Host ""
Write-Host "DONE." -ForegroundColor Green
Write-Host "Next: open /brokers in the app -- the Zerodha card should now show 'Edit/Reauth/Disconnect' buttons." -ForegroundColor Yellow

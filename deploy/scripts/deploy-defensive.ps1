param(
    [string]$VMHost = "141.148.192.4",
    [string]$VMUser = "ubuntu",
    [string]$SshKey = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key"
)
$ErrorActionPreference = "Continue"

$RepoOwner = "kumarikrisnan509-eng"
$RepoName  = "ats"
# T-190 redaction (P0 #1 from SECRETS-AUDIT.md): rotated; literal removed from repo.
# Set GH_PAT before running, or source deploy\scripts\secrets.local.ps1.
if (-not $env:GH_PAT) {
    $localSecrets = Join-Path $PSScriptRoot 'secrets.local.ps1'
    if (Test-Path $localSecrets) { . $localSecrets } else {
        Write-Error "GH_PAT env var not set and $localSecrets missing. See deploy\scripts\secrets.local.example.ps1."; exit 1
    }
}
$Pat       = if ($env:GH_PAT) { $env:GH_PAT } else { $Pat }
$GhcrPat   = if ($env:GH_GHCR_PAT) { $env:GH_GHCR_PAT } elseif ($GhcrPat) { $GhcrPat } else { $env:GH_PAT }

$ProjectRoot = (Get-Item (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..\..")).FullName

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Defensive batch: ticker backoff cap + auto-login self-guard" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] git add + commit + push" -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    if (Test-Path ".git/index.lock") { Remove-Item ".git/index.lock" -Force -ErrorAction SilentlyContinue }
    & git add deploy/backend/brokers/zerodha-broker.js deploy/scripts/auto-login-host.js 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git commit -m "defensive: ticker autoReconnect(20,60s) + noreconnect handler; auto-login skips when already connected" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git push "https://${RepoOwner}:${Pat}@github.com/${RepoOwner}/${RepoName}.git" HEAD:main 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    $newSha = (& git rev-parse HEAD).Trim().Substring(0, 12)
    Write-Host "    new commit: $newSha" -ForegroundColor Green
}
finally { Pop-Location }

Write-Host ""
Write-Host "[2/4] Wait for CI + deploy" -ForegroundColor Yellow
$start   = Get-Date
$apiBase = "https://api.github.com/repos/${RepoOwner}/${RepoName}/actions/runs"
$headers = @{ Authorization = "Bearer $Pat"; Accept = "application/vnd.github+json" }
while ($true) {
    $elapsed = (Get-Date) - $start
    if ($elapsed.TotalMinutes -gt 18) { Write-Host "    timeout" -ForegroundColor Red; break }
    Start-Sleep -Seconds 20
    try {
        $resp = Invoke-RestMethod -Uri "${apiBase}?per_page=3" -Headers $headers
        $d = $resp.workflow_runs | Where-Object { $_.name -eq 'deploy' -and $_.head_sha.StartsWith($newSha) } | Select-Object -First 1
        if (-not $d) { Write-Host ("    [{0:mm\:ss}] queued" -f $elapsed) -ForegroundColor DarkGray; continue }
        $conc = $d.conclusion; if ($null -eq $conc -or $conc -eq '') { $conc = '-' }
        Write-Host ("    [{0:mm\:ss}] status={1} conclusion={2}" -f $elapsed, $d.status, $conc) -ForegroundColor DarkGray
        if ($d.status -eq 'completed') { break }
    } catch { Write-Host "    api err: $_" -ForegroundColor DarkGray }
}

Write-Host ""
Write-Host "[3/4] Pin tag + restart + sync auto-login-host.js to VM" -ForegroundColor Yellow
$pkgs = Invoke-RestMethod -Uri "https://api.github.com/users/${RepoOwner}/packages/container/ats-backend/versions?per_page=3" -Headers $headers
$newTag = ($pkgs[0].metadata.container.tags | Where-Object { $_ -ne 'latest' } | Select-Object -First 1)
Write-Host "    new image tag: $newTag" -ForegroundColor Green

# auto-login-host.js runs on the VM HOST (not container), so we scp the new version too.
& scp -i $SshKey -o StrictHostKeyChecking=no "$ProjectRoot/deploy/scripts/auto-login-host.js" "${VMUser}@${VMHost}:/tmp/auto-login-host.js" 2>&1 | ForEach-Object { Write-Host "    scp: $_" -ForegroundColor DarkGray }

$bashScript = @"
#!/usr/bin/env bash
set -uo pipefail

echo "==> Move new auto-login-host.js into /opt/ats/scripts/"
sudo mv /tmp/auto-login-host.js /opt/ats/scripts/auto-login-host.js
sudo chmod 0644 /opt/ats/scripts/auto-login-host.js

echo "==> Pin new container image"
echo "$GhcrPat" | sudo docker login ghcr.io -u "$RepoOwner" --password-stdin
sudo bash -c "cat > /opt/ats/compose/.env" <<EOF
ATS_REPO_OWNER=$RepoOwner
ATS_IMAGE_TAG=$newTag
EOF
echo "$newTag" | sudo tee /opt/ats/compose/.current-tag > /dev/null
cd /opt/ats/compose
sudo docker compose --env-file /opt/ats/compose/.env down 2>&1 | tail -2
sudo docker compose --env-file /opt/ats/compose/.env up -d 2>&1 | tail -2
sleep 12

echo
echo "==> Verify auto-login self-guard kicks in (broker should be connected now)"
sudo -H node /opt/ats/scripts/auto-login-host.js 2>&1 | tail -5

echo
echo "==> Health"
curl -sS --max-time 5 http://127.0.0.1:8080/api/health | python3 -c "
import sys, json
d = json.load(sys.stdin)
b = d['broker']
print(f'  connected={b[\"connected\"]} hasAccessToken={b[\"hasAccessToken\"]} subscribed={b[\"subscribedInstruments\"]} reconnectAttempts={b[\"reconnectAttempts\"]}')
"
"@

$OutFile = Join-Path $ProjectRoot "deploy\.deploy-defensive-output.txt"
$bashScript | & ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "[4/4] External smoke" -ForegroundColor Yellow
Start-Sleep -Seconds 4
try {
    $h = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/health"
    $b = $h.broker
    Write-Host ("  broker.connected={0} subscribed={1} reconnectAttempts={2}" -f $b.connected, $b.subscribedInstruments, $b.reconnectAttempts)
} catch { Write-Host "  err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DONE. Output: $OutFile" -ForegroundColor Green
Write-Host ""
Write-Host "  Changes:" -ForegroundColor Green
Write-Host "    1. Ticker: bounded to 20 reconnects, max 60s between attempts" -ForegroundColor White
Write-Host "    2. Ticker: emits 'noreconnect' event when it gives up" -ForegroundColor White
Write-Host "    3. auto-login-host.js: skips immediately if broker already connected" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Green

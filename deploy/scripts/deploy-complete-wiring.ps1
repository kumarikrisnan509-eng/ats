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
Write-Host "  Complete wiring batch: /api/system/info + 3 screens" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] git add + commit + push" -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    if (Test-Path ".git/index.lock") { Remove-Item ".git/index.lock" -Force -ErrorAction SilentlyContinue }
    & git add deploy/backend/server.js src/screen-brokers.jsx src/screen-alerts-builder.jsx src/screen-infra.jsx 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git commit -m "complete-wiring: /api/system/info aggregator + brokers/alerts-builder/infra screens go live" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
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
Write-Host "[3/4] Pin new tag + restart" -ForegroundColor Yellow
$pkgs = Invoke-RestMethod -Uri "https://api.github.com/users/${RepoOwner}/packages/container/ats-backend/versions?per_page=3" -Headers $headers
$newTag = ($pkgs[0].metadata.container.tags | Where-Object { $_ -ne 'latest' } | Select-Object -First 1)
Write-Host "    new image tag: $newTag" -ForegroundColor Green

$bashScript = @"
#!/usr/bin/env bash
set -uo pipefail
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
echo OK
"@

$OutFile = Join-Path $ProjectRoot "deploy\.deploy-complete-wiring-output.txt"
$bashScript | & ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "[4/4] Smoke /api/system/info" -ForegroundColor Yellow
Start-Sleep -Seconds 4
try {
    $s = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/system/info"
    Write-Host "  process:"
    Write-Host ("    uptime={0}s pid={1} node={2} mem={3} MB" -f $s.process.uptimeSec, $s.process.pid, $s.process.nodeVersion, $s.process.memMB)
    Write-Host "  broker:"
    Write-Host ("    name={0} connected={1} subscribed={2} instruments.size={3}" -f $s.broker.name, $s.broker.connected, $s.broker.subscribedInstruments, $s.broker.instruments.size)
    Write-Host "  components:"
    Write-Host ("    alerts={0} watchlist={1} scanner.history={2}" -f $s.components.alerts.total, $s.components.watchlist.count, $s.components.scanner.historyCount)
    Write-Host "  audit log:"
    Write-Host ("    size={0} bytes  seq={1}" -f $s.auditLog.sizeBytes, $s.auditLog.seq)
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DONE. Output: $OutFile" -ForegroundColor Green
Write-Host ""
Write-Host "  After this deploy, the following screens render LIVE data:" -ForegroundColor Green
Write-Host "    - Brokers     -> /api/profile + /api/health.broker (auto-refresh 15s)" -ForegroundColor White
Write-Host "    - Alerts      -> /api/alerts CRUD (create/delete/list, auto-refresh 30s)" -ForegroundColor White
Write-Host "    - Infrastructure -> /api/system/info (auto-refresh 10s)" -ForegroundColor White
Write-Host ""
Write-Host "  If broker.connected=false, run FORCE-LOGIN.cmd first." -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green

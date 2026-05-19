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
Write-Host "  Phase 2 wiring: signals, strategies, backtest, circuits, margin" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] git add + commit + push" -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    if (Test-Path ".git/index.lock") { Remove-Item ".git/index.lock" -Force -ErrorAction SilentlyContinue }
    & git add src/screen-margin.jsx src/screen-circuits.jsx src/screen-signals.jsx src/screen-strategies.jsx src/screen-backtest.jsx 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git commit -m "phase2 wiring: margin, circuits, signals, strategies, backtest pull live backend data" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
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
Write-Host "[3/4] Pin tag + restart" -ForegroundColor Yellow
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

$OutFile = Join-Path $ProjectRoot "deploy\.deploy-phase2-output.txt"
$bashScript | & ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "[4/4] Smoke the underlying APIs each screen depends on" -ForegroundColor Yellow
Start-Sleep -Seconds 4

Write-Host ""
Write-Host "  /api/margins (margin screen):" -ForegroundColor Green
try {
    $m = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/margins"
    $cash = if ($m.margins.equity.available.cash) { $m.margins.equity.available.cash } else { $m.margins.equity.available.live_balance }
    Write-Host ("    available.cash = INR {0}" -f $cash)
    Write-Host ("    utilised.debits = INR {0}" -f $m.margins.equity.utilised.debits)
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "  /api/audit?limit=8 (circuits screen):" -ForegroundColor Green
try {
    $a = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/audit?limit=8"
    $a.rows | Select-Object -First 8 | ForEach-Object {
        Write-Host ("    {0,-22} {1}" -f $_.event, $_.ts)
    }
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "  /api/scanner/history (signals screen):" -ForegroundColor Green
try {
    $s = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/scanner/history?limit=10"
    Write-Host ("    history count: {0}" -f $s.history.Count)
    $s.history | Select-Object -First 5 | ForEach-Object {
        Write-Host ("    {0,-15} {1,-20} {2}" -f $_.symbol, $_.signal, $_.message)
    }
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "  /api/strategies (strategies screen):" -ForegroundColor Green
try {
    $st = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/strategies"
    $st.strategies | ForEach-Object { Write-Host ("    {0,-18} {1}" -f $_.id, $_.name) }
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "  POST /api/backtest RELIANCE rsi_mean_revert (backtest screen):" -ForegroundColor Green
$body = @{ symbol="RELIANCE"; strategy="rsi_mean_revert"; from=(Get-Date).AddDays(-365).ToString("yyyy-MM-dd"); to=(Get-Date).ToString("yyyy-MM-dd"); qty=10; interval="day" } | ConvertTo-Json
try {
    $b = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/backtest" -Method POST -ContentType "application/json" -Body $body -TimeoutSec 30
    Write-Host ("    trades={0} winRate={1} pnl=INR {2}  equity.length={3}" -f $b.stats.trades, $b.stats.winRate, $b.stats.totalPnl, $b.equity.Count)
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DONE. Output: $OutFile" -ForegroundColor Green
Write-Host ""
Write-Host "  After this deploy, these screens render LIVE data:" -ForegroundColor Green
Write-Host "    Margin       -> /api/margins (real cash, refreshes 60s)" -ForegroundColor White
Write-Host "    Circuits     -> /api/audit (real recent events, refreshes 30s)" -ForegroundColor White
Write-Host "    Signals      -> /api/scanner/history (refreshes 30s) + atsTriggerScan()" -ForegroundColor White
Write-Host "    Strategies   -> /api/strategies + atsBacktestWatchlist()" -ForegroundColor White
Write-Host "    Backtest     -> /api/backtest (live RELIANCE equity curve, on strategy change)" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Green

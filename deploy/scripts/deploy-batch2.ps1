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
Write-Host "  Deploy batch: backtest + indices + position-size" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] git add + commit + push" -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    if (Test-Path ".git/index.lock") { Remove-Item ".git/index.lock" -Force -ErrorAction SilentlyContinue }
    & git add deploy/backend/backtest.js deploy/backend/server.js deploy/backend/brokers/gateway.js deploy/backend/brokers/zerodha-broker.js 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git commit -m "batch: backtest engine + indices snapshot + position-size calc" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
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
    if ($elapsed.TotalMinutes -gt 15) { Write-Host "    timeout" -ForegroundColor Red; break }
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
Write-Host "[3/4] Pin new tag + restart container" -ForegroundColor Yellow
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

$OutFile = Join-Path $ProjectRoot "deploy\.deploy-batch2-output.txt"
$bashScript | & ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "[4/4] External smoke (PowerShell side)" -ForegroundColor Yellow
Start-Sleep -Seconds 4

# Indices snapshot
Write-Host ""
Write-Host "  /api/indices/snapshot:" -ForegroundColor Green
try {
    $i = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/indices/snapshot"
    Write-Host ("    count={0}" -f $i.count)
    $i.rows | ForEach-Object { Write-Host ("    {0,-20} ltp={1}" -f $_.symbol, $_.ltp) }
} catch { Write-Host "    err: $_" -ForegroundColor Red }

# Position size calculator
Write-Host ""
Write-Host "  /api/calc/position-size (account=500000 risk=1pct stopLoss=2pct entry=1358.8):" -ForegroundColor Green
try {
    $p = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/calc/position-size?account=500000&riskPct=1&stopLossPct=2&entryPrice=1358.8"
    Write-Host ("    riskAmount      = INR {0}" -f $p.riskAmount)
    Write-Host ("    perShareRisk    = INR {0}" -f $p.perShareRisk)
    Write-Host ("    suggestedQty    = {0}" -f $p.suggestedQty)
    Write-Host ("    capitalDeployed = INR {0}" -f $p.capitalDeployed)
    Write-Host ("    utilization     = {0} pct" -f $p.capitalUtilizationPct)
} catch { Write-Host "    err: $_" -ForegroundColor Red }

# Backtest
Write-Host ""
Write-Host "  POST /api/backtest RELIANCE rsi_mean_revert 1y daily:" -ForegroundColor Green
$body = @{
    symbol    = "RELIANCE"
    strategy  = "rsi_mean_revert"
    from      = (Get-Date).AddDays(-365).ToString("yyyy-MM-dd")
    to        = (Get-Date).ToString("yyyy-MM-dd")
    qty       = 10
    interval  = "day"
} | ConvertTo-Json
try {
    $bt = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/backtest" -Method POST -ContentType "application/json" -Body $body
    Write-Host ("    bars={0} trades={1} winRate={2} pct" -f $bt.bars, $bt.stats.trades, $bt.stats.winRate)
    Write-Host ("    totalPnl     = INR {0}" -f $bt.stats.totalPnl)
    Write-Host ("    avgWin       = INR {0}" -f $bt.stats.avgWin)
    Write-Host ("    avgLoss      = INR {0}" -f $bt.stats.avgLoss)
    Write-Host ("    maxDD        = INR {0} ({1} pct)" -f $bt.stats.maxDrawdown, $bt.stats.maxDrawdownPct)
    Write-Host ("    buy+hold     = INR {0}" -f $bt.stats.buyAndHoldPnl)
    Write-Host ("    vs buy+hold  = INR {0}" -f $bt.stats.vsBuyAndHold)
    if ($bt.trades.Count -gt 0) {
        Write-Host "    last 5 trades:"
        $bt.trades | Select-Object -Last 5 | ForEach-Object {
            Write-Host ("      {0}->{1} qty={2} entry={3} exit={4} pnl={5}" -f $_.entryDate.Substring(0,10), $_.exitDate.Substring(0,10), $_.qty, $_.entryPrice, $_.exitPrice, $_.pnl)
        }
    }
} catch { Write-Host "    err: $_" -ForegroundColor Red }

# Same backtest, ema_cross strategy
Write-Host ""
Write-Host "  POST /api/backtest RELIANCE ema_cross 1y daily:" -ForegroundColor Green
$body2 = @{
    symbol    = "RELIANCE"
    strategy  = "ema_cross"
    from      = (Get-Date).AddDays(-365).ToString("yyyy-MM-dd")
    to        = (Get-Date).ToString("yyyy-MM-dd")
    qty       = 10
    interval  = "day"
} | ConvertTo-Json
try {
    $bt2 = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/backtest" -Method POST -ContentType "application/json" -Body $body2
    Write-Host ("    trades={0} winRate={1} pct" -f $bt2.stats.trades, $bt2.stats.winRate)
    Write-Host ("    totalPnl     = INR {0}" -f $bt2.stats.totalPnl)
    Write-Host ("    vs buy+hold  = INR {0}" -f $bt2.stats.vsBuyAndHold)
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DONE. Output: $OutFile" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

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
Write-Host "  Tier 3: paper trading simulator + hyperparameter tuner" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] git add + commit + push" -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    if (Test-Path ".git/index.lock") { Remove-Item ".git/index.lock" -Force -ErrorAction SilentlyContinue }
    & git add deploy/backend/paper.js deploy/backend/server.js 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git commit -m "tier3: PaperTrading module with tick-driven fills + POST /api/tune grid-search optimizer" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
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

$OutFile = Join-Path $ProjectRoot "deploy\.deploy-tier3-output.txt"
$bashScript | & ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "[4/4] Smoke tests" -ForegroundColor Yellow
Start-Sleep -Seconds 4

Write-Host ""
Write-Host "  /api/paper (initial state):" -ForegroundColor Green
try {
    $p = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/paper"
    Write-Host ("    cash=INR {0}  openPositions={1}  filledOrders={2}  realizedPnl=INR {3}" -f $p.stats.cash, $p.stats.openPositions, $p.stats.filledOrders, $p.stats.realizedPnl)
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "  POST /api/paper/order RELIANCE BUY MARKET qty=10:" -ForegroundColor Green
$ord = @{ symbol="RELIANCE"; side="BUY"; qty=10; type="MARKET" } | ConvertTo-Json
try {
    $r = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/paper/order" -Method POST -ContentType "application/json" -Body $ord
    Write-Host ("    order id={0}  status={1}" -f $r.order.id, $r.order.status)
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "  Wait 5s for next tick to fill it, then check..." -ForegroundColor DarkGray
Start-Sleep -Seconds 5
try {
    $p2 = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/paper"
    Write-Host ("    cash=INR {0}  openPositions={1}  filledOrders={2}" -f $p2.stats.cash, $p2.stats.openPositions, $p2.stats.filledOrders)
    if ($p2.stats.openPositions -gt 0) {
        $pp = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/paper/positions"
        $pp.positions | ForEach-Object {
            Write-Host ("    position: {0,-12} qty={1} avg={2}  ltp={3}  unrealizedPnl=INR {4}" -f $_.symbol, $_.qty, $_.avgPrice, $_.ltp, $_.unrealizedPnl)
        }
    }
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "  POST /api/tune RELIANCE rsi_mean_revert (grid: period x entryRsi x exitRsi):" -ForegroundColor Green
$from = (Get-Date).AddDays(-365).ToString("yyyy-MM-dd")
$to   = (Get-Date).ToString("yyyy-MM-dd")
$tuneBody = @{
    symbol    = "RELIANCE"
    strategy  = "rsi_mean_revert"
    from      = $from
    to        = $to
    qty       = 10
    interval  = "day"
    top       = 5
    paramGrid = @{
        period   = @(10, 14, 20)
        entryRsi = @(25, 30, 35)
        exitRsi  = @(65, 70, 75)
    }
} | ConvertTo-Json -Depth 5
try {
    $t = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/tune" -Method POST -ContentType "application/json" -Body $tuneBody -TimeoutSec 60
    Write-Host ("    ran {0} combinations on {1} candles" -f $t.combinations, $t.candlesUsed)
    Write-Host "    top 5 by totalPnl:"
    $t.top | ForEach-Object {
        $ps = ($_.params.PSObject.Properties | ForEach-Object { "$($_.Name)=$($_.Value)" }) -join ", "
        Write-Host ("      pnl=INR {0,7}  winRate={1,6}%  trades={2,3}  vsBH={3,6}  {{ {4} }}" -f $_.totalPnl, $_.winRate, $_.trades, $_.vsBuyAndHold, $ps)
    }
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "  /api/system/info -- paper now in components:" -ForegroundColor Green
try {
    $si = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/system/info"
    if ($si.components.paper) {
        Write-Host ("    paper: cash=INR {0}  openPositions={1}  filledOrders={2}  trades={3}" -f $si.components.paper.cash, $si.components.paper.openPositions, $si.components.paper.filledOrders, $si.components.paper.closedTrades)
    }
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DONE. Output: $OutFile" -ForegroundColor Green
Write-Host ""
Write-Host "  Paper trading endpoints:" -ForegroundColor Green
Write-Host "    GET    /api/paper                            (stats)" -ForegroundColor White
Write-Host "    GET    /api/paper/orders                     (all orders)" -ForegroundColor White
Write-Host "    GET    /api/paper/positions                  (open + unrealized P&L)" -ForegroundColor White
Write-Host "    GET    /api/paper/trades?limit=50            (closed trade ledger)" -ForegroundColor White
Write-Host "    POST   /api/paper/order  {symbol,side,qty,type,price?}" -ForegroundColor White
Write-Host "    DELETE /api/paper/order/:id                  (cancel pending)" -ForegroundColor White
Write-Host "    POST   /api/paper/reset                      (wipe + reset cash)" -ForegroundColor White
Write-Host ""
Write-Host "  Tuner endpoint:" -ForegroundColor Green
Write-Host "    POST   /api/tune  {symbol,strategy,paramGrid,from,to,qty?,top?}" -ForegroundColor White
Write-Host ""
Write-Host "  Starting cash: INR 1,000,000 (set PAPER_STARTING_CASH env to override)" -ForegroundColor Yellow
Write-Host "============================================================" -ForegroundColor Green

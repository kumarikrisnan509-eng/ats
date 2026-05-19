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
Write-Host "  Deploy batch 3: watchlist backtest + strategies + order-place" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] git add + commit + push" -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    if (Test-Path ".git/index.lock") { Remove-Item ".git/index.lock" -Force -ErrorAction SilentlyContinue }
    & git add deploy/backend/server.js 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git commit -m "batch3: watchlist backtest + strategy registry + order-place scaffolding (kill-switch gated)" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
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

$OutFile = Join-Path $ProjectRoot "deploy\.deploy-batch3-output.txt"
$bashScript | & ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "[4/4] External smoke (PowerShell side)" -ForegroundColor Yellow
Start-Sleep -Seconds 4

# Strategy registry
Write-Host ""
Write-Host "  /api/strategies:" -ForegroundColor Green
try {
    $s = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/strategies"
    $s.strategies | ForEach-Object {
        Write-Host ("    {0,-18} {1}" -f $_.id, $_.name)
        Write-Host ("                       {0}" -f $_.description) -ForegroundColor DarkGray
        $_.params | ForEach-Object {
            Write-Host ("                       param: {0} ({1}, default={2})" -f $_.name, $_.type, $_.default) -ForegroundColor DarkGray
        }
    }
} catch { Write-Host "    err: $_" -ForegroundColor Red }

# Watchlist backtest
Write-Host ""
Write-Host "  POST /api/backtest/watchlist rsi_mean_revert 1y daily qty=10:" -ForegroundColor Green
$body = @{
    strategy = "rsi_mean_revert"
    from     = (Get-Date).AddDays(-365).ToString("yyyy-MM-dd")
    to       = (Get-Date).ToString("yyyy-MM-dd")
    qty      = 10
    interval = "day"
} | ConvertTo-Json
try {
    $bt = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/backtest/watchlist" -Method POST -ContentType "application/json" -Body $body -TimeoutSec 120
    $a = $bt.aggregate
    Write-Host ("    aggregate: scanned={0} profitable={1} losing={2} totalPnl=INR {3} avgWinRate={4} pct" -f $a.symbolsScanned, $a.profitable, $a.losing, $a.totalPnl, $a.avgWinRate)
    Write-Host ""
    Write-Host "    Ranked per-symbol (best to worst):"
    Write-Host ("    {0,-13} {1,7} {2,8} {3,11} {4,11}" -f "SYMBOL", "TRADES", "WIN%", "PNL", "vs B+H")
    $bt.results | ForEach-Object {
        Write-Host ("    {0,-13} {1,7} {2,8} {3,11} {4,11}" -f $_.symbol, $_.trades, $_.winRate, $_.totalPnl, $_.vsBuyAndHold)
    }
    if ($bt.errors) {
        Write-Host ""
        Write-Host "    errors:"
        $bt.errors.PSObject.Properties | ForEach-Object { Write-Host ("      {0}: {1}" -f $_.Name, $_.Value) -ForegroundColor DarkYellow }
    }
} catch { Write-Host "    err: $_" -ForegroundColor Red }

# Order place - kill-switch gated
Write-Host ""
Write-Host "  POST /api/orders/place (kill-switch should block - 503 expected):" -ForegroundColor Green
$orderBody = @{
    strategyTag  = "test"
    symbol       = "RELIANCE"
    side         = "BUY"
    quantity     = 1
    product      = "CNC"
    orderType    = "MARKET"
} | ConvertTo-Json
try {
    $o = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/orders/place" -Method POST -ContentType "application/json" -Body $orderBody
    Write-Host ("    UNEXPECTED OK: {0}" -f ($o | ConvertTo-Json -Depth 3)) -ForegroundColor Yellow
} catch {
    $resp = $_.Exception.Response
    if ($resp) {
        $code = [int]$resp.StatusCode
        Write-Host ("    blocked as expected, http={0}" -f $code) -ForegroundColor Green
        try {
            $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
            $payload = $reader.ReadToEnd()
            $parsed = $payload | ConvertFrom-Json
            Write-Host ("      reason: {0}" -f $parsed.reason)
            Write-Host ("      message: {0}" -f $parsed.message)
            Write-Host ("      clientOrderId: {0}" -f $parsed.clientOrderId)
        } catch {}
    } else { Write-Host "    err: $_" -ForegroundColor Red }
}

# Order place - invalid payload (validation test)
Write-Host ""
Write-Host "  POST /api/orders/place with bad side (validation test):" -ForegroundColor Green
$badBody = @{ strategyTag="t"; symbol="RELIANCE"; side="HOLD"; quantity=1; product="CNC"; orderType="MARKET" } | ConvertTo-Json
try {
    $o = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/orders/place" -Method POST -ContentType "application/json" -Body $badBody
    Write-Host ("    UNEXPECTED OK") -ForegroundColor Yellow
} catch {
    $resp = $_.Exception.Response
    if ($resp) {
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $payload = $reader.ReadToEnd()
        Write-Host ("    400 rejected: {0}" -f $payload) -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DONE. Output: $OutFile" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

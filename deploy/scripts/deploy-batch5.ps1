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
Write-Host "  Deploy batch 5: option chain inline quotes + MACD + Bollinger" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] git add + commit + push" -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    if (Test-Path ".git/index.lock") { Remove-Item ".git/index.lock" -Force -ErrorAction SilentlyContinue }
    & git add deploy/backend/scanner.js deploy/backend/backtest.js deploy/backend/server.js 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git commit -m "batch5: option chain inline quotes; MACD + Bollinger strategies + indicator helpers" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
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
sleep 15
echo OK
"@

$OutFile = Join-Path $ProjectRoot "deploy\.deploy-batch5-output.txt"
$bashScript | & ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "[4/4] External smoke (PowerShell side)" -ForegroundColor Yellow
Start-Sleep -Seconds 4

# Strategy registry now lists 4 strategies
Write-Host ""
Write-Host "  /api/strategies (should now list 4):" -ForegroundColor Green
try {
    $s = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/strategies"
    $s.strategies | ForEach-Object { Write-Host ("    {0,-18} {1}" -f $_.id, $_.name) }
} catch { Write-Host "    err: $_" -ForegroundColor Red }

# Backtest each new strategy on RELIANCE 1y daily
$from = (Get-Date).AddDays(-365).ToString("yyyy-MM-dd")
$to   = (Get-Date).ToString("yyyy-MM-dd")
foreach ($strat in @("rsi_mean_revert","ema_cross","macd_cross","bollinger")) {
    Write-Host ""
    Write-Host ("  POST /api/backtest RELIANCE {0}:" -f $strat) -ForegroundColor Green
    $body = @{ symbol="RELIANCE"; strategy=$strat; from=$from; to=$to; qty=10; interval="day" } | ConvertTo-Json
    try {
        $r = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/backtest" -Method POST -ContentType "application/json" -Body $body -TimeoutSec 30
        $st = $r.stats
        Write-Host ("    trades={0} winRate={1} pct totalPnl=INR {2} vsBH={3}" -f $st.trades, $st.winRate, $st.totalPnl, $st.vsBuyAndHold)
    } catch { Write-Host "    err: $_" -ForegroundColor Red }
}

# Option chain with inline quotes (works even if market is closed - returns last LTP/OI)
Write-Host ""
Write-Host "  /api/option-chain NIFTY first expiry, includeQuotes=true, 5 strikes around ATM:" -ForegroundColor Green
try {
    $e = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/option-expiries?underlying=NIFTY"
    $firstExpiry = $e.expiries | Select-Object -First 1
    Write-Host ("    expiry: {0}" -f $firstExpiry)
    $url = "https://ats.rajasekarselvam.com/api/option-chain?symbol=NIFTY&expiry=$firstExpiry&includeQuotes=true&strikes=5"
    $c = Invoke-RestMethod -Uri $url -TimeoutSec 60
    Write-Host ("    spot={0}  total strikes={1}  ATM idx={2}  legs quoted={3}" -f $c.spot, $c.count, $c.atmIndex, $c.enriched.legsQuoted)
    if ($c.atmIndex -ne $null) {
        $lo = [math]::Max(0, $c.atmIndex - 3)
        $hi = [math]::Min($c.strikes.Count - 1, $c.atmIndex + 3)
        Write-Host ""
        Write-Host ("    {0,7}  {1,-10} {2,-10} {3,-10}  {4,-10} {5,-10} {6,-10}" -f "STRIKE", "CE LTP", "CE OI", "CE VOL", "PE LTP", "PE OI", "PE VOL")
        for ($i = $lo; $i -le $hi; $i++) {
            $row = $c.strikes[$i]
            $ce = $row.ce; $pe = $row.pe
            $ceLtp = if ($ce -and $ce.ltp -ne $null) { $ce.ltp } else { "-" }
            $ceOi  = if ($ce -and $ce.oi  -ne $null) { $ce.oi } else { "-" }
            $ceVol = if ($ce -and $ce.volume -ne $null) { $ce.volume } else { "-" }
            $peLtp = if ($pe -and $pe.ltp -ne $null) { $pe.ltp } else { "-" }
            $peOi  = if ($pe -and $pe.oi  -ne $null) { $pe.oi } else { "-" }
            $peVol = if ($pe -and $pe.volume -ne $null) { $pe.volume } else { "-" }
            $mark = if ($i -eq $c.atmIndex) { "  <- ATM" } else { "" }
            Write-Host ("    {0,7}  {1,-10} {2,-10} {3,-10}  {4,-10} {5,-10} {6,-10}{7}" -f $row.strike, $ceLtp, $ceOi, $ceVol, $peLtp, $peOi, $peVol, $mark)
        }
    }
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "  /api/health (backend should be steady):" -ForegroundColor Green
try {
    $h = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/health"
    Write-Host ("    uptime={0}s broker.connected={1} subscribed={2} instruments.size={3}" -f $h.uptimeSec, $h.broker.connected, $h.broker.subscribedInstruments, $h.broker.instruments.size)
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DONE. Output: $OutFile" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

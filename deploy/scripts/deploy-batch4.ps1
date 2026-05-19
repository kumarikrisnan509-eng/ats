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
Write-Host "  Deploy batch 4: option chain + expiries + symbol meta" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] git add + commit + push" -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    if (Test-Path ".git/index.lock") { Remove-Item ".git/index.lock" -Force -ErrorAction SilentlyContinue }
    & git add deploy/backend/brokers/zerodha-instruments.js deploy/backend/brokers/zerodha-broker.js deploy/backend/server.js 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git commit -m "batch4: option chain + expiries + symbol metadata; instruments v2 schema with strike/lotSize" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
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
Write-Host "[3/4] Pin new tag + restart container (instruments cache will rebuild)" -ForegroundColor Yellow
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
sleep 20
echo OK
"@

$OutFile = Join-Path $ProjectRoot "deploy\.deploy-batch4-output.txt"
$bashScript | & ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "[4/4] External smoke (PowerShell side)" -ForegroundColor Yellow
Start-Sleep -Seconds 4

# Symbol meta
Write-Host ""
Write-Host "  /api/symbol/RELIANCE:" -ForegroundColor Green
try {
    $r = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/symbol/RELIANCE"
    Write-Host ("    meta: token={0} exchange={1} segment={2} lot={3} tick={4}" -f $r.meta.token, $r.meta.exchange, $r.meta.segment, $r.meta.lotSize, $r.meta.tickSize)
    if ($r.quote) { Write-Host ("    quote.last_price = {0}" -f $r.quote.last_price) }
} catch { Write-Host "    err: $_" -ForegroundColor Red }

# Expiries
Write-Host ""
Write-Host "  /api/option-expiries?underlying=NIFTY (first 5):" -ForegroundColor Green
try {
    $e = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/option-expiries?underlying=NIFTY"
    Write-Host ("    count: {0}" -f $e.count)
    $e.expiries | Select-Object -First 5 | ForEach-Object { Write-Host "    $_" }
    $firstExpiry = $e.expiries | Select-Object -First 1
} catch { Write-Host "    err: $_" -ForegroundColor Red; $firstExpiry = $null }

# Option chain (using first expiry)
if ($firstExpiry) {
    Write-Host ""
    Write-Host "  /api/option-chain?symbol=NIFTY&expiry=$firstExpiry (around ATM):" -ForegroundColor Green
    try {
        $c = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/option-chain?symbol=NIFTY&expiry=$firstExpiry"
        Write-Host ("    spot={0} expiry={1} strikes={2} lot={3}" -f $c.spot, $c.expiry, $c.count, $c.lotSize)
        # Find ATM strike if we have spot, show 5 strikes either side
        if ($c.spot) {
            $atmIdx = 0
            for ($i = 0; $i -lt $c.strikes.Count; $i++) {
                if ([math]::Abs($c.strikes[$i].strike - $c.spot) -lt [math]::Abs($c.strikes[$atmIdx].strike - $c.spot)) {
                    $atmIdx = $i
                }
            }
            $lo = [math]::Max(0, $atmIdx - 5)
            $hi = [math]::Min($c.strikes.Count - 1, $atmIdx + 5)
            Write-Host ("    showing strikes {0}..{1} (ATM={2}):" -f $lo, $hi, $c.strikes[$atmIdx].strike)
            for ($i = $lo; $i -le $hi; $i++) {
                $row = $c.strikes[$i]
                $ceSym = if ($row.ce) { $row.ce.tradingsymbol } else { "-" }
                $peSym = if ($row.pe) { $row.pe.tradingsymbol } else { "-" }
                $marker = if ($i -eq $atmIdx) { " <- ATM" } else { "" }
                Write-Host ("      strike={0,8}  CE={1,-22}  PE={2,-22}{3}" -f $row.strike, $ceSym, $peSym, $marker)
            }
        } else {
            Write-Host "    (no NIFTY spot in tick cache yet - showing first 6 strikes:)"
            $c.strikes | Select-Object -First 6 | ForEach-Object {
                Write-Host ("      strike={0,8}  CE={1}  PE={2}" -f $_.strike, ($_.ce.tradingsymbol), ($_.pe.tradingsymbol))
            }
        }
    } catch { Write-Host "    err: $_" -ForegroundColor Red }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DONE. Output: $OutFile" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

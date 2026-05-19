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
Write-Host "  Fix: instrument expiry -> ISO YYYY-MM-DD (v3 cache schema)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] git add + commit + push" -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    if (Test-Path ".git/index.lock") { Remove-Item ".git/index.lock" -Force -ErrorAction SilentlyContinue }
    & git add deploy/backend/brokers/zerodha-instruments.js 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git commit -m "fix: coerce expiry to ISO YYYY-MM-DD; bump cache to v3 to force refresh" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
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
Write-Host "[3/4] Pin new tag + restart (cache rebuild on boot)" -ForegroundColor Yellow
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
echo "waiting 30s for instrument-master refresh..."
sleep 30
echo OK
"@

$OutFile = Join-Path $ProjectRoot "deploy\.deploy-fix-expiry-output.txt"
$bashScript | & ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "[4/4] External smoke" -ForegroundColor Yellow
Start-Sleep -Seconds 4

Write-Host ""
Write-Host "  /api/option-expiries?underlying=NIFTY (should now be ISO YYYY-MM-DD):" -ForegroundColor Green
try {
    $e = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/option-expiries?underlying=NIFTY"
    Write-Host ("    count={0}" -f $e.count)
    $e.expiries | Select-Object -First 8 | ForEach-Object { Write-Host "    $_" }
    $firstExpiry = $e.expiries | Select-Object -First 1
} catch { Write-Host "    err: $_" -ForegroundColor Red; $firstExpiry = $null }

if ($firstExpiry) {
    Write-Host ""
    Write-Host "  /api/option-chain NIFTY first expiry around ATM:" -ForegroundColor Green
    try {
        $c = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/option-chain?symbol=NIFTY&expiry=$firstExpiry"
        Write-Host ("    spot={0} expiry={1} strikes={2} lot={3}" -f $c.spot, $c.expiry, $c.count, $c.lotSize)
        if ($c.spot -and $c.strikes.Count -gt 0) {
            $atmIdx = 0
            for ($i = 0; $i -lt $c.strikes.Count; $i++) {
                if ([math]::Abs($c.strikes[$i].strike - $c.spot) -lt [math]::Abs($c.strikes[$atmIdx].strike - $c.spot)) { $atmIdx = $i }
            }
            $lo = [math]::Max(0, $atmIdx - 5)
            $hi = [math]::Min($c.strikes.Count - 1, $atmIdx + 5)
            Write-Host ("    ATM strike: {0} (idx {1}/{2})" -f $c.strikes[$atmIdx].strike, $atmIdx, $c.strikes.Count)
            for ($i = $lo; $i -le $hi; $i++) {
                $row = $c.strikes[$i]
                $ceSym = if ($row.ce) { $row.ce.tradingsymbol } else { "-" }
                $peSym = if ($row.pe) { $row.pe.tradingsymbol } else { "-" }
                $marker = if ($i -eq $atmIdx) { " <- ATM" } else { "" }
                Write-Host ("      {0,7}  CE={1,-22}  PE={2,-22}{3}" -f $row.strike, $ceSym, $peSym, $marker)
            }
        } else {
            Write-Host "    strikes empty (no NIFTY options for expiry $firstExpiry yet)"
        }
    } catch { Write-Host "    err: $_" -ForegroundColor Red }
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DONE. Output: $OutFile" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

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
Write-Host "  Deploy trader utilities batch: snapshot + movers + audit" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] git add + commit + push" -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    if (Test-Path ".git/index.lock") { Remove-Item ".git/index.lock" -Force -ErrorAction SilentlyContinue }
    & git add deploy/backend/server.js 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git commit -m "utilities: watchlist snapshot, movers, audit reader" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
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
curl -sS --max-time 5 http://127.0.0.1:8080/api/health | head -c 400
"@

$OutFile = Join-Path $ProjectRoot "deploy\.deploy-utilities-output.txt"
$bashScript | & ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "[4/4] External smoke test (PowerShell side only)" -ForegroundColor Yellow
Start-Sleep -Seconds 4

# Snapshot
Write-Host ""
Write-Host "  watchlist snapshot (first 6 rows):" -ForegroundColor Green
try {
    $s = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/watchlist/snapshot"
    Write-Host ("    ok={0} count={1}" -f $s.ok, $s.count)
    $s.rows | Select-Object -First 6 | ForEach-Object {
        $ltp = if ($null -eq $_.ltp) { "n/a" } else { [string]$_.ltp }
        $pct = if ($null -eq $_.changePct) { "" } else { ([string]$_.changePct) + "%" }
        $line = "    {0,-12} ltp={1,10}  chg={2,7}  pct={3}" -f $_.symbol, $ltp, $_.change, $pct
        Write-Host $line
    }
} catch { Write-Host "    err: $_" -ForegroundColor Red }

# Movers
Write-Host ""
Write-Host "  movers limit=5:" -ForegroundColor Green
try {
    $m = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/movers?limit=5"
    Write-Host ("    scannable total: {0}" -f $m.total)
    Write-Host "    GAINERS:" -ForegroundColor DarkGray
    $m.gainers | ForEach-Object {
        Write-Host ("      {0,-12} ltp={1,10}  +{2}%" -f $_.symbol, $_.ltp, $_.changePct) -ForegroundColor Green
    }
    Write-Host "    LOSERS:" -ForegroundColor DarkGray
    $m.losers | ForEach-Object {
        Write-Host ("      {0,-12} ltp={1,10}  {2}%" -f $_.symbol, $_.ltp, $_.changePct) -ForegroundColor Red
    }
} catch { Write-Host "    err: $_" -ForegroundColor Red }

# Audit
Write-Host ""
Write-Host "  audit recent (limit=10):" -ForegroundColor Green
try {
    $a = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/audit?limit=10"
    Write-Host ("    count: {0}" -f $a.count)
    $a.rows | Select-Object -First 10 | ForEach-Object {
        Write-Host ("    seq={0,-5} ts={1}  event={2}" -f $_.seq, $_.ts, $_.event)
    }
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DONE. Output: $OutFile" -ForegroundColor Green
Write-Host ""
Write-Host "  Endpoints now live (call from PowerShell or curl):" -ForegroundColor Green
Write-Host "    GET  /api/watchlist/snapshot" -ForegroundColor White
Write-Host "    GET  /api/movers?limit=10" -ForegroundColor White
Write-Host "    GET  /api/audit (params: since, event, limit)" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Green

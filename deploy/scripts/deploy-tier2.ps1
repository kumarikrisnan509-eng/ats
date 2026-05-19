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
Write-Host "  Tier 2: rate-limit + input-size guards + optional API auth" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] git add + commit + push" -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    if (Test-Path ".git/index.lock") { Remove-Item ".git/index.lock" -Force -ErrorAction SilentlyContinue }
    & git add deploy/backend/server.js 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git commit -m "tier2: per-IP rate limit, backtest/historical range guards, env-gated bearer auth on mutations + audit" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
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

$OutFile = Join-Path $ProjectRoot "deploy\.deploy-tier2-output.txt"
$bashScript | & ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "[4/4] Smoke tests" -ForegroundColor Yellow
Start-Sleep -Seconds 4

Write-Host ""
Write-Host "  /api/auth-mode (auth opt-in status):" -ForegroundColor Green
try {
    $a = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/auth-mode"
    Write-Host ("    authRequired={0}  (set ATS_OPS_KEY in /etc/ats/backend.env to enable)" -f $a.authRequired)
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "  Backtest range-guard: 10-year request should be rejected:" -ForegroundColor Green
$bigBody = @{ symbol="RELIANCE"; strategy="rsi_mean_revert"; from="2016-01-01"; to="2026-05-14"; qty=10; interval="day" } | ConvertTo-Json
try {
    $r = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/backtest" -Method POST -ContentType "application/json" -Body $bigBody -TimeoutSec 30
    Write-Host ("    UNEXPECTED OK: trades={0}" -f $r.stats.trades) -ForegroundColor Yellow
} catch {
    $resp = $_.Exception.Response
    if ($resp) {
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $body = $reader.ReadToEnd()
        Write-Host ("    [400 expected] {0}" -f $body) -ForegroundColor Green
    } else { Write-Host "    err: $_" -ForegroundColor Red }
}

Write-Host ""
Write-Host "  Historical range-guard: 3-year request should be rejected:" -ForegroundColor Green
try {
    $r = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/historical?symbol=RELIANCE&interval=day&from=2023-01-01&to=2026-05-14"
    Write-Host ("    UNEXPECTED OK: count={0}" -f $r.count) -ForegroundColor Yellow
} catch {
    $resp = $_.Exception.Response
    if ($resp) {
        $reader = New-Object System.IO.StreamReader($resp.GetResponseStream())
        $body = $reader.ReadToEnd()
        Write-Host ("    [400 expected] {0}" -f $body) -ForegroundColor Green
    }
}

Write-Host ""
Write-Host "  Rate limit (rapid-fire 30 requests in 5s, want some 429s if limit was tiny -- with 300/min default, all 200):" -ForegroundColor Green
$ok = 0; $rl = 0
for ($i = 0; $i -lt 30; $i++) {
    try {
        $r = Invoke-WebRequest -Uri "https://ats.rajasekarselvam.com/api/health" -UseBasicParsing -TimeoutSec 5
        if ($r.StatusCode -eq 200) { $ok++ }
    } catch {
        if ($_.Exception.Response.StatusCode -eq 429) { $rl++ }
    }
}
Write-Host ("    of 30 requests: 200={0}  429={1}  (default limit 300/min, so all 200 is correct)" -f $ok, $rl)

Write-Host ""
Write-Host "  /api/health (sanity, no auth required):" -ForegroundColor Green
try {
    $h = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/health"
    Write-Host ("    ok={0} uptime={1}s broker.connected={2}" -f $h.ok, $h.uptimeSec, $h.broker.connected)
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DONE. Output: $OutFile" -ForegroundColor Green
Write-Host ""
Write-Host "  To ENABLE bearer-token auth on mutations + /api/audit:" -ForegroundColor Yellow
Write-Host "    1. ssh ubuntu@141.148.192.4" -ForegroundColor White
Write-Host "    2. sudo nano /etc/ats/backend.env" -ForegroundColor White
Write-Host "    3. Add a line:  ATS_OPS_KEY=some-long-random-string-you-pick" -ForegroundColor White
Write-Host "    4. sudo systemctl restart docker  (or docker compose restart)" -ForegroundColor White
Write-Host "    5. Frontend then needs:  Authorization: Bearer <that-key>  on POST/PUT/DELETE" -ForegroundColor White
Write-Host "" -ForegroundColor Yellow
Write-Host "  Other env knobs (defaults shown):" -ForegroundColor Yellow
Write-Host "    RATE_LIMIT=300            # requests per IP per window" -ForegroundColor White
Write-Host "    RATE_WINDOW_MS=60000      # window length in ms (60s)" -ForegroundColor White
Write-Host "    BACKTEST_MAX_DAYS=1825    # 5 years max for /api/backtest" -ForegroundColor White
Write-Host "    HISTORICAL_MAX_DAYS=730   # 2 years max for /api/historical" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Green

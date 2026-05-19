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
Write-Host "  Tier 2b: /metrics + order postback webhook" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] git add + commit + push" -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    if (Test-Path ".git/index.lock") { Remove-Item ".git/index.lock" -Force -ErrorAction SilentlyContinue }
    & git add deploy/backend/server.js 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git commit -m "tier2b: Prometheus /metrics endpoint + /api/brokers/zerodha/postback HMAC-verified webhook" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
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
Write-Host "[3/4] Pin tag + restart + scrape /metrics locally" -ForegroundColor Yellow
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

echo
echo "==> /metrics from inside the VM (loopback OK):"
curl -sS http://127.0.0.1:8080/metrics | head -40

echo
echo "==> postback endpoint sanity (bad checksum should 401):"
curl -sS -w "\n  HTTP: %{http_code}\n" -X POST http://127.0.0.1:8080/api/brokers/zerodha/postback \
  -H "Content-Type: application/json" \
  -d '{"order_id":"FAKE123","status":"COMPLETE","checksum":"badchecksum"}'
"@

$OutFile = Join-Path $ProjectRoot "deploy\.deploy-tier2b-output.txt"
$bashScript | & ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "[4/4] External smoke" -ForegroundColor Yellow
Start-Sleep -Seconds 4

Write-Host ""
Write-Host "  /metrics from external (should be 403 -- public IP not whitelisted):" -ForegroundColor Green
try {
    $r = Invoke-WebRequest -Uri "https://ats.rajasekarselvam.com/metrics" -UseBasicParsing
    Write-Host ("    UNEXPECTED status: {0} (expected 403)" -f $r.StatusCode) -ForegroundColor Yellow
} catch {
    $resp = $_.Exception.Response
    if ($resp) {
        Write-Host ("    [{0} expected] {1}" -f [int]$resp.StatusCode, $resp.StatusDescription) -ForegroundColor Green
    } else { Write-Host "    err: $_" -ForegroundColor Red }
}

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
Write-Host "  /metrics is loopback-only by default." -ForegroundColor Yellow
Write-Host "  To allow external scraping (Grafana/Prometheus from internet):" -ForegroundColor Yellow
Write-Host "    1. ssh ubuntu@141.148.192.4" -ForegroundColor White
Write-Host "    2. sudo nano /etc/ats/backend.env" -ForegroundColor White
Write-Host "    3. Add:  ATS_METRICS_TOKEN=some-long-random-string" -ForegroundColor White
Write-Host "    4. cd /opt/ats/compose && sudo docker compose restart" -ForegroundColor White
Write-Host "    5. Scraper passes header:  X-Metrics-Token: <that-string>" -ForegroundColor White
Write-Host ""
Write-Host "  To enable Kite order postbacks:" -ForegroundColor Yellow
Write-Host "    1. Visit https://developers.kite.trade/apps/" -ForegroundColor White
Write-Host "    2. Open the 'ATS Cockpit' app -> Edit" -ForegroundColor White
Write-Host "    3. Postback URL:  https://ats.rajasekarselvam.com/api/brokers/zerodha/postback" -ForegroundColor White
Write-Host "    4. Save. Real orders will now fire UI updates + Telegram on FILLED/REJECTED" -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Green

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
Write-Host "  Deploy: persistent watchlist + /ws auto-subscribe merge" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] git add + commit + push" -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    if (Test-Path ".git/index.lock") { Remove-Item ".git/index.lock" -Force -ErrorAction SilentlyContinue }
    & git add `
        deploy/backend/watchlist.js `
        deploy/backend/server.js `
        src/live-ticks.jsx `
        2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git commit -m "watchlist: persistent JSON store + REST CRUD + /ws auto-subscribe merge" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
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
    if ($elapsed.TotalMinutes -gt 15) { Write-Host "    timeout"; break }
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
Write-Host "[3/4] Pin new tag + restart + smoke-test" -ForegroundColor Yellow
$pkgs = Invoke-RestMethod -Uri "https://api.github.com/users/${RepoOwner}/packages/container/ats-backend/versions?per_page=3" -Headers $headers
$newTag = ($pkgs[0].metadata.container.tags | Where-Object { $_ -ne 'latest' } | Select-Object -First 1)
Write-Host "    new image tag: $newTag" -ForegroundColor Green

$bashScript = @'
#!/usr/bin/env bash
set -uo pipefail
NEW_TAG="__NEW_TAG__"
OWNER="__OWNER__"
PAT="__PAT__"
ENV_COMPOSE=/opt/ats/compose/.env

echo "$PAT" | sudo docker login ghcr.io -u "$OWNER" --password-stdin
sudo bash -c "cat > $ENV_COMPOSE" <<EOF
ATS_REPO_OWNER=$OWNER
ATS_IMAGE_TAG=$NEW_TAG
EOF
echo "$NEW_TAG" | sudo tee /opt/ats/compose/.current-tag > /dev/null

cd /opt/ats/compose
sudo docker compose --env-file "$ENV_COMPOSE" down 2>&1 | tail -2
sudo docker compose --env-file "$ENV_COMPOSE" up -d 2>&1 | tail -2
sleep 12

echo
echo "  /api/health (watchlist stats)"
curl -sS --max-time 5 http://127.0.0.1:8080/api/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('   alerts:', d.get('alerts')); print('   watchlist:', d.get('watchlist'))"

echo
echo "  GET /api/watchlist (should be empty)"
curl -sS --max-time 5 http://127.0.0.1:8080/api/watchlist
echo
echo
echo "  PUT /api/watchlist — save [RELIANCE, INFY, TCS, ITC, SBIN]"
curl -sS --max-time 5 -X PUT http://127.0.0.1:8080/api/watchlist \
  -H "Content-Type: application/json" \
  -d "{\"symbols\":[\"RELIANCE\",\"INFY\",\"TCS\",\"ITC\",\"SBIN\"]}"
echo
echo
echo "  POST /api/watchlist/add — add HDFCBANK"
curl -sS --max-time 5 -X POST http://127.0.0.1:8080/api/watchlist/add \
  -H "Content-Type: application/json" \
  -d "{\"symbol\":\"HDFCBANK\"}"
echo
echo
echo "  GET /api/watchlist (should have 6)"
curl -sS --max-time 5 http://127.0.0.1:8080/api/watchlist | python3 -m json.tool
echo
echo "  POST /api/watchlist/remove — drop ITC"
curl -sS --max-time 5 -X POST http://127.0.0.1:8080/api/watchlist/remove \
  -H "Content-Type: application/json" \
  -d "{\"symbol\":\"ITC\"}"
echo
echo
echo "  Container: how many instruments are now subscribed?"
curl -sS --max-time 5 http://127.0.0.1:8080/api/health | python3 -c "import sys,json; d=json.load(sys.stdin); print('   subscribedInstruments:', d['broker']['subscribedInstruments'])"
'@
$bashScript = $bashScript.Replace('__NEW_TAG__', $newTag).Replace('__OWNER__', $RepoOwner).Replace('__PAT__', $GhcrPat)
$OutFile = Join-Path $ProjectRoot "deploy\.deploy-watchlist-output.txt"
$bashScript | & ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "[4/4] External smoke test" -ForegroundColor Yellow
Start-Sleep -Seconds 3
try {
    $w = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/watchlist"
    Write-Host "    watchlist: $($w.symbols -join ', ')" -ForegroundColor Green
} catch { Write-Host "    probe err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DONE. Output: $OutFile" -ForegroundColor Green
Write-Host "" -ForegroundColor Green
Write-Host "  Try it:" -ForegroundColor Green
Write-Host '    GET /api/watchlist' -ForegroundColor White
Write-Host '    PUT /api/watchlist  body: {"symbols":["RELIANCE","TCS","NIFTY 50"]}' -ForegroundColor White
Write-Host '    POST /api/watchlist/add     body: {"symbol":"HDFCBANK"}' -ForegroundColor White
Write-Host '    POST /api/watchlist/remove  body: {"symbol":"HDFCBANK"}' -ForegroundColor White
Write-Host "============================================================" -ForegroundColor Green

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
Write-Host "  Deploy: initial /api/quotes snapshot on /ws welcome" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] git add + commit + push" -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    if (Test-Path ".git/index.lock") { Remove-Item ".git/index.lock" -Force -ErrorAction SilentlyContinue }
    & git add src/live-ticks.jsx 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git commit -m "live-ticks: fetch initial /api/quotes snapshot on welcome so seeds dont stick" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
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
Write-Host "[3/4] Pin new tag + restart on VM" -ForegroundColor Yellow
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
echo "  /api/health"
curl -sS --max-time 5 http://127.0.0.1:8080/api/health | head -c 300
echo
echo
echo "  /api/quotes for 4 equity"
curl -sS --max-time 5 "http://127.0.0.1:8080/api/quotes?symbols=RELIANCE,HDFCBANK,TCS,INFY" | python3 -c "import sys,json; q=json.load(sys.stdin).get('quotes',{}); [print(f'    {k}: ltp={v[\"last_price\"]:>10} close={v[\"ohlc\"][\"close\"]:>10}') for k,v in q.items()]"
'@
$bashScript = $bashScript.Replace('__NEW_TAG__', $newTag).Replace('__OWNER__', $RepoOwner).Replace('__PAT__', $GhcrPat)
$OutFile = Join-Path $ProjectRoot "deploy\.deploy-initial-snapshot-output.txt"
$bashScript | & ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "[4/4] External smoke test" -ForegroundColor Yellow
Start-Sleep -Seconds 3
try {
    $q = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/quotes?symbols=RELIANCE,HDFCBANK,TCS,INFY"
    Write-Host "    real prices:" -ForegroundColor Green
    $q.quotes.PSObject.Properties | ForEach-Object {
        Write-Host ("      {0,-15} ltp={1,10}  close={2,10}" -f $_.Name, $_.Value.last_price, $_.Value.ohlc.close) -ForegroundColor White
    }
} catch { Write-Host "    probe err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DONE. Output: $OutFile" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

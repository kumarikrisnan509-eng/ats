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

$ProjectRoot = (Get-Item (Join-Path (Split-Path -Parent $MyInvocation.MyCommand.Path) "..\..")).FullName

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Deploy P0+P0b+P1+P2: instruments master + REST endpoints" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# ============ STEP 1: commit + push ============
Write-Host "[1/5] git add + commit + push" -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    if (Test-Path ".git/index.lock") {
        Remove-Item ".git/index.lock" -Force -ErrorAction SilentlyContinue
        Write-Host "    cleared .git/index.lock" -ForegroundColor DarkGray
    }
    & git add `
        deploy/backend/brokers/zerodha-instruments.js `
        deploy/backend/brokers/zerodha-broker.js `
        deploy/backend/brokers/mock-broker.js `
        deploy/backend/brokers/gateway.js `
        deploy/backend/brokers/index.js `
        deploy/backend/server.js `
        src/mock-data.jsx `
        src/screen-portfolio.jsx `
        src/live-ticks.jsx `
        2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git commit -m "live data: instrument-master loader, /ws subscribe, /api portfolio+orders, fix mock-data demo gate" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git push "https://${RepoOwner}:${Pat}@github.com/${RepoOwner}/${RepoName}.git" HEAD:main 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    $newSha = (& git rev-parse HEAD).Trim().Substring(0, 12)
    Write-Host "    new commit: $newSha" -ForegroundColor Green
}
finally { Pop-Location }

# ============ STEP 2: poll GitHub Actions ============
Write-Host ""
Write-Host "[2/5] Waiting for CI + deploy to complete (5-7 min)" -ForegroundColor Yellow
$start   = Get-Date
$apiBase = "https://api.github.com/repos/${RepoOwner}/${RepoName}/actions/runs"
$headers = @{ Authorization = "Bearer $Pat"; Accept = "application/vnd.github+json" }

$deployOk = $false
while ($true) {
    $elapsed = (Get-Date) - $start
    if ($elapsed.TotalMinutes -gt 15) { Write-Host "    timeout waiting" -ForegroundColor Red; break }
    Start-Sleep -Seconds 20
    try {
        $resp = Invoke-RestMethod -Uri "${apiBase}?per_page=3" -Headers $headers
        $deploy = $resp.workflow_runs | Where-Object { $_.name -eq 'deploy' -and $_.head_sha.StartsWith($newSha) } | Select-Object -First 1
        if (-not $deploy) {
            Write-Host ("    [{0:mm\:ss}] deploy run not visible yet" -f $elapsed) -ForegroundColor DarkGray
            continue
        }
        $conc = $deploy.conclusion
        if ($null -eq $conc -or $conc -eq '') { $conc = '-' }
        Write-Host ("    [{0:mm\:ss}] deploy status={1} conclusion={2}" -f $elapsed, $deploy.status, $conc) -ForegroundColor DarkGray
        if ($deploy.status -eq 'completed') {
            $deployOk = ($deploy.conclusion -eq 'success')
            break
        }
    } catch {
        Write-Host "    api err: $_" -ForegroundColor DarkGray
    }
}

# ============ STEP 3: latest GHCR tag ============
Write-Host ""
Write-Host "[3/5] Fetching new GHCR tag" -ForegroundColor Yellow
$pkgUrl = "https://api.github.com/users/${RepoOwner}/packages/container/ats-backend/versions?per_page=3"
$pkgs = Invoke-RestMethod -Uri $pkgUrl -Headers $headers
$latestPkg = $pkgs | Select-Object -First 1
$newTag = ($latestPkg.metadata.container.tags | Where-Object { $_ -ne 'latest' } | Select-Object -First 1)
Write-Host "    latest image tag: $newTag" -ForegroundColor Green

# ============ STEP 4: SSH to VM, pin tag, restart, verify ============
Write-Host ""
Write-Host "[4/5] SSH to VM: pin new tag, restart, verify new endpoints" -ForegroundColor Yellow

$ghcrPat = "${GH_GHCR_PAT}"

$bashScript = @'
#!/usr/bin/env bash
set -uo pipefail

NEW_TAG="__NEW_TAG__"
OWNER="__OWNER__"
PAT="__PAT__"
ENV_COMPOSE=/opt/ats/compose/.env

echo "  STEP 4a: docker login to GHCR"
echo "$PAT" | sudo docker login ghcr.io -u "$OWNER" --password-stdin

echo "  STEP 4b: pin tag $NEW_TAG"
sudo bash -c "cat > $ENV_COMPOSE" <<EOF
ATS_REPO_OWNER=$OWNER
ATS_IMAGE_TAG=$NEW_TAG
EOF
echo "$NEW_TAG" | sudo tee /opt/ats/compose/.current-tag > /dev/null

echo "  STEP 4c: down + up -d"
cd /opt/ats/compose
sudo docker compose --env-file "$ENV_COMPOSE" down 2>&1 | tail -2
sudo docker compose --env-file "$ENV_COMPOSE" up -d 2>&1 | tail -2
sleep 15

echo
echo "  STEP 4d: /api/health (broker + instruments stats)"
curl -sS --max-time 5 http://127.0.0.1:8080/api/health 2>&1
echo

echo
echo "  STEP 4e: NEW endpoint /api/portfolio/holdings"
curl -sS --max-time 5 http://127.0.0.1:8080/api/portfolio/holdings 2>&1 | head -c 600
echo
echo

echo "  STEP 4f: NEW endpoint /api/profile"
curl -sS --max-time 5 http://127.0.0.1:8080/api/profile 2>&1 | head -c 400
echo
echo

echo "  STEP 4g: container logs (last 25 lines)"
sudo docker logs --tail 25 ats-backend 2>&1 | tail -25
'@

$bashScript = $bashScript.Replace('__NEW_TAG__', $newTag)
$bashScript = $bashScript.Replace('__OWNER__',   $RepoOwner)
$bashScript = $bashScript.Replace('__PAT__',     $ghcrPat)

$OutFile = Join-Path $ProjectRoot "deploy\.deploy-p0-p2-output.txt"
$bashScript | & ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object {
    Write-Host "    $_" -ForegroundColor DarkGray
}

# ============ STEP 5: external smoke test ============
Write-Host ""
Write-Host "[5/5] External smoke test" -ForegroundColor Yellow
Start-Sleep -Seconds 3
try {
    Write-Host "    -- /api/health --"
    $health = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/health"
    ($health | ConvertTo-Json -Depth 5) -split "`n" | ForEach-Object { Write-Host "    $_" }
    Write-Host ""
    Write-Host "    -- /api/portfolio/holdings --"
    $h = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/portfolio/holdings"
    ($h | ConvertTo-Json -Depth 4) -split "`n" | Select-Object -First 20 | ForEach-Object { Write-Host "    $_" }
} catch {
    Write-Host "    probe error: $_" -ForegroundColor Red
}

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DONE. Output: $OutFile" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

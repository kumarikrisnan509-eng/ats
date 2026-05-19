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
Write-Host "  P3 deploy: esbuild pre-transform (no Babel in browser)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] git add + commit + push" -ForegroundColor Yellow
Push-Location $ProjectRoot
try {
    if (Test-Path ".git/index.lock") { Remove-Item ".git/index.lock" -Force -ErrorAction SilentlyContinue }
    & git add deploy/build/transform.js deploy/docker/Dockerfile app.html 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git commit -m "P3: pre-transform JSX to JS at Docker build time via esbuild; drop Babel-standalone CDN" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    & git push "https://${RepoOwner}:${Pat}@github.com/${RepoOwner}/${RepoName}.git" HEAD:main 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    $newSha = (& git rev-parse HEAD).Trim().Substring(0, 12)
    Write-Host "    new commit: $newSha" -ForegroundColor Green
}
finally { Pop-Location }

Write-Host ""
Write-Host "[2/4] Wait for CI + deploy (Docker build takes longer now -- esbuild stage adds ~30s)" -ForegroundColor Yellow
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
echo
echo "  --- Sanity: count of .js files in /var/www ---"
ls /var/www/ats.rajasekarselvam.com/src/*.js 2>/dev/null | wc -l
echo "  --- Sanity: any .jsx files still there? (expect 0) ---"
ls /var/www/ats.rajasekarselvam.com/src/*.jsx 2>/dev/null | wc -l
echo "  --- first 3 transformed .js files ---"
ls /var/www/ats.rajasekarselvam.com/src/*.js 2>/dev/null | head -3
echo OK
"@

$OutFile = Join-Path $ProjectRoot "deploy\.deploy-p3-esbuild-output.txt"
$bashScript | & ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

Write-Host ""
Write-Host "[4/4] External smoke + frontend asset checks" -ForegroundColor Yellow
Start-Sleep -Seconds 4

Write-Host ""
Write-Host "  Frontend smoke (no Babel, .js script tags):" -ForegroundColor Green
try {
    $html = (Invoke-WebRequest -Uri "https://ats.rajasekarselvam.com/" -UseBasicParsing).Content
    $hasBabel = if ($html -match "babel/standalone") { "YES (bad)" } else { "no (good)" }
    $hasJsx   = if ($html -match '\.jsx"') { "YES (bad)" } else { "no (good)" }
    $jsCount  = ([regex]::Matches($html, '<script src="src/[^"]+\.js"')).Count
    Write-Host ("    Babel CDN present:  {0}" -f $hasBabel)
    Write-Host ("    .jsx references:    {0}" -f $hasJsx)
    Write-Host ("    .js script tags:    {0}" -f $jsCount)
} catch { Write-Host "    fetch err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "  Spot-check a couple of transformed JS files are served:" -ForegroundColor Green
foreach ($f in @("market-data.js","app.js","screen-dashboard.js","live-ticks.js")) {
    try {
        $r = Invoke-WebRequest -Uri "https://ats.rajasekarselvam.com/src/$f" -Method Head -UseBasicParsing
        Write-Host ("    {0,-26} {1}  {2} bytes" -f $f, $r.StatusCode, $r.Headers."Content-Length")
    } catch { Write-Host ("    {0,-26} ERR: {1}" -f $f, $_) -ForegroundColor Red }
}

Write-Host ""
Write-Host "  /api/health (backend should be untouched):" -ForegroundColor Green
try {
    $h = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/health"
    Write-Host ("    ok={0} env={1} uptime={2}s broker.connected={3}" -f $h.ok, $h.env, $h.uptimeSec, $h.broker.connected)
} catch { Write-Host "    err: $_" -ForegroundColor Red }

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  DONE. Output: $OutFile" -ForegroundColor Green
Write-Host ""
Write-Host "  Expected: first paint drops from ~3-4s to ~1s" -ForegroundColor Green
Write-Host "  Reload https://ats.rajasekarselvam.com and check devtools Network tab" -ForegroundColor Green
Write-Host "  (you should NOT see babel.min.js downloading -- saves ~2MB)" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

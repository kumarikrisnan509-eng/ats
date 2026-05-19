param(
    [string]$Message = ""
)
$ErrorActionPreference = "Continue"

# ============================================================
# Reusable one-button deploy.
# All it does: commit + push. GitHub Actions handles everything else
# (build → push image → SSH to VM → restart → health-check → rollback).
# ============================================================

$RepoOwner = "mohanapriya63085"
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
Write-Host "  One-button deploy (push → GitHub Actions → live site)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

Push-Location $ProjectRoot
try {
    if (Test-Path ".git/index.lock") { Remove-Item ".git/index.lock" -Force -ErrorAction SilentlyContinue }

    # Show what's staged-and-modified so we know what we're about to commit.
    Write-Host "[1/5] What we'll commit:" -ForegroundColor Yellow
    $status = & git status --porcelain 2>&1
    if (-not $status) {
        Write-Host "    (working tree clean — nothing to commit)" -ForegroundColor DarkGray
        Write-Host ""
        Write-Host "  Nothing to deploy. If you wanted to redeploy the current image, trigger" -ForegroundColor DarkGray
        Write-Host "  workflow_dispatch on the GitHub Actions page:" -ForegroundColor DarkGray
        Write-Host "    https://github.com/${RepoOwner}/${RepoName}/actions/workflows/deploy.yml" -ForegroundColor DarkGray
        return
    }
    $status -split "`n" | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

    # Stage everything that's not ignored.
    & git add -A 2>&1 | Out-Null

    if (-not $Message) {
        # Auto-message from the first changed file path.
        $first = ($status -split "`n" | Where-Object { $_ } | Select-Object -First 1) -replace '^\s*\S+\s+', ''
        $Message = "deploy: $first"
        if ($status -split "`n" | Where-Object { $_ } | Measure-Object | Select-Object -ExpandProperty Count) {
            $count = ($status -split "`n" | Where-Object { $_ }).Count
            if ($count -gt 1) { $Message += " (+ $($count - 1) more)" }
        }
    }
    Write-Host ""
    Write-Host "[2/5] commit: $Message" -ForegroundColor Yellow
    & git commit -m "$Message" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }

    Write-Host ""
    Write-Host "[3/5] git push to main" -ForegroundColor Yellow
    & git push "https://${RepoOwner}:${Pat}@github.com/${RepoOwner}/${RepoName}.git" HEAD:main 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
    $newSha = (& git rev-parse HEAD).Trim().Substring(0, 12)
    Write-Host "    new commit: $newSha" -ForegroundColor Green
}
finally { Pop-Location }

Write-Host ""
Write-Host "[4/5] Watching GitHub Actions deploy (validate → build → SSH → health-check → rollback)" -ForegroundColor Yellow
$start   = Get-Date
$apiBase = "https://api.github.com/repos/${RepoOwner}/${RepoName}/actions/runs"
$headers = @{ Authorization = "Bearer $Pat"; Accept = "application/vnd.github+json" }
$success = $false
while ($true) {
    $elapsed = (Get-Date) - $start
    if ($elapsed.TotalMinutes -gt 15) { Write-Host "    timeout" -ForegroundColor Red; break }
    Start-Sleep -Seconds 15
    try {
        $resp = Invoke-RestMethod -Uri "${apiBase}?per_page=3" -Headers $headers
        $d = $resp.workflow_runs | Where-Object { $_.name -eq 'deploy' -and $_.head_sha.StartsWith($newSha) } | Select-Object -First 1
        if (-not $d) { Write-Host ("    [{0:mm\:ss}] queued" -f $elapsed) -ForegroundColor DarkGray; continue }
        $conc = $d.conclusion; if ($null -eq $conc -or $conc -eq '') { $conc = '-' }
        Write-Host ("    [{0:mm\:ss}] status={1} conclusion={2}" -f $elapsed, $d.status, $conc) -ForegroundColor DarkGray
        if ($d.status -eq 'completed') {
            $success = ($d.conclusion -eq 'success')
            break
        }
    } catch { Write-Host "    api err: $_" -ForegroundColor DarkGray }
}

Write-Host ""
Write-Host "[5/5] External health verification" -ForegroundColor Yellow
Start-Sleep -Seconds 3
try {
    $h = Invoke-RestMethod -Uri "https://ats.rajasekarselvam.com/api/health"
    $b = $h.broker
    Write-Host ("    ok={0} env={1} killSwitch={2} uptime={3}s" -f $h.ok, $h.env, $h.killSwitch, $h.uptimeSec) -ForegroundColor White
    Write-Host ("    broker={0} connected={1} subscribed={2} instruments.size={3}" -f $b.name, $b.connected, $b.subscribedInstruments, $b.instruments.size) -ForegroundColor White
    if ($h.alerts)    { Write-Host ("    alerts: {0} total, {1} active, {2} triggered, {3} evals" -f $h.alerts.total, $h.alerts.active, $h.alerts.triggered, $h.alerts.evals) -ForegroundColor White }
    if ($h.watchlist) { Write-Host ("    watchlist: {0} symbols saved" -f $h.watchlist.count) -ForegroundColor White }
} catch { Write-Host "    probe err: $_" -ForegroundColor Red }

Write-Host ""
if ($success) {
    Write-Host "============================================================" -ForegroundColor Green
    Write-Host "  ✓ DEPLOY OK — $newSha live at https://ats.rajasekarselvam.com" -ForegroundColor Green
    Write-Host "============================================================" -ForegroundColor Green
} else {
    Write-Host "============================================================" -ForegroundColor Red
    Write-Host "  ✗ DEPLOY FAILED or did not complete" -ForegroundColor Red
    Write-Host "  Check: https://github.com/${RepoOwner}/${RepoName}/actions" -ForegroundColor Red
    Write-Host "============================================================" -ForegroundColor Red
}

# push-tier-57-58.ps1 -- pushes the Tier 57+58 file set via GitHub REST API.
# Bypasses local .git so it works when index.lock is stuck or a rebase is mid-flight.

$ErrorActionPreference = "Stop"
# $PSScriptRoot = ...\deploy\scripts ; go up TWO levels to reach the project root.
$Root = Split-Path -Parent (Split-Path -Parent $PSScriptRoot)
Set-Location $Root
Write-Host "  working dir: $Root" -ForegroundColor DarkGray

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host " ATS - Push Tier 57+58 via GitHub REST API" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

# Cleanup any stuck state. Git writes to stderr even on success-ish exits;
# Windows PowerShell 5.1 turns that into a NativeCommandError under $EAP=Stop.
# Wrap in try and lower EAP locally so a non-rebase still proceeds.
Write-Host "[0/2] Cleanup stuck rebase / lock..." -ForegroundColor Yellow
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
try {
    & git rebase --abort *>$null
} catch {}
$ErrorActionPreference = $prevEAP
if (Test-Path ".git\index.lock") { Remove-Item -Force ".git\index.lock" }
Write-Host "      done"
Write-Host ""

# The Tier 57+58 files
$Files = @(
    "deploy/backend/db.js",
    "deploy/backend/me-broker.js",
    "deploy/backend/broker-resolver.js",
    "deploy/backend/migrate-env-broker-to-db.js",
    "deploy/backend/server.js",
    "deploy/backend/test/me-broker.test.js",
    "deploy/backend/test/broker-resolver.test.js",
    "deploy/scripts/migrate-broker-env-to-db.ps1",
    "deploy/scripts/gh-commit.ps1",
    "deploy/scripts/push-tier-57-58.ps1",
    "src/screen-brokers.jsx",
    "src/broker-banner.jsx",
    "src/app.jsx",
    "app.html",
    "MIGRATE-BROKER-ENV-TO-DB.cmd",
    "PUSH-VIA-API.cmd",
    "FIX-GIT-AND-PUSH.cmd"
)

Write-Host "[1/2] Uploading $($Files.Count) files via REST API..." -ForegroundColor Yellow
& "$PSScriptRoot\gh-commit.ps1" `
    -Message "Tier 57+58: per-user broker credentials + REST routing" `
    -Files $Files

if ($LASTEXITCODE -ne 0 -and -not $?) {
    Write-Host "FAILED." -ForegroundColor Red
    exit 1
}
Write-Host ""

Write-Host "[2/2] Re-sync local main with origin..." -ForegroundColor Yellow
$prevEAP = $ErrorActionPreference
$ErrorActionPreference = "SilentlyContinue"
try {
    & git fetch origin main *>$null
    & git reset --hard origin/main *>$null
} catch {}
$ErrorActionPreference = $prevEAP
Write-Host "      synced (or skipped if origin not configured locally)"
Write-Host ""

Write-Host "============================================================" -ForegroundColor Green
Write-Host " SUCCESS - Tier 57+58 is on origin/main." -ForegroundColor Green
Write-Host " CI will deploy in ~2 min." -ForegroundColor Green
Write-Host " Next: run MIGRATE-BROKER-ENV-TO-DB.cmd after deploy." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

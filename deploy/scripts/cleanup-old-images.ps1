param(
    [string]$VMHost = "141.148.192.4",
    [string]$VMUser = "ubuntu",
    [string]$SshKey = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key"
)
$ErrorActionPreference = "Continue"

# ============================================================
#  Cleanup: Group A only.
#  Removes old project Docker images that are NOT used by ATS.
#  We target images by ID (not tag) so we cannot accidentally
#  remove the live ghcr.io/.../ats-backend:* images.
# ============================================================

# Image IDs captured from analyze-vm.ps1 output on 2026-05-13:
$ImagesToRemove = @(
    @{ id = "ed057a2da0b7"; tag = "ats-backend:latest (old local)"; size = "1.26 GB" }
    @{ id = "958fdc6fe1e3"; tag = "ats-celery-beat:latest";        size = "1.26 GB" }
    @{ id = "60444e62c23c"; tag = "ats-celery-worker:latest";      size = "1.26 GB" }
    @{ id = "3c33b81c1288"; tag = "ats-frontend:latest";           size = "264 MB"  }
    @{ id = "6b5b37eb35bb"; tag = "grafana/grafana:10.2.3";        size = "523 MB"  }
    @{ id = "f379a20ce9dd"; tag = "grafana/loki:2.9.4";            size = "97.8 MB" }
    @{ id = "3667f68c8f33"; tag = "grafana/promtail:2.9.4";        size = "273 MB"  }
    @{ id = "645eda1c2477"; tag = "nginx:alpine";                  size = "92.7 MB" }
    @{ id = "8b81dd37ff02"; tag = "redis:7-alpine";                size = "61.9 MB" }
    @{ id = "332b99870c99"; tag = "timescale/timescaledb:latest-pg16"; size = "1.66 GB" }
)

# IDs that MUST be preserved (paranoia guard).
$KeepIds = @(
    "ccb614616f32"  # ghcr.io/.../ats-backend:3531678bda60  (LIVE)
    "0e786496220a"  # ghcr.io/.../ats-backend:latest         (LIVE alias)
    "e4ee33a0e39d"  # ghcr.io/.../ats-backend:52b24733f6ac   (previous, rollback)
)

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  VM cleanup - Group A (old project images only)" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""
Write-Host "Will REMOVE (by image ID):" -ForegroundColor Yellow
foreach ($img in $ImagesToRemove) {
    Write-Host ("  - {0,-12}  {1,-45}  {2}" -f $img.id, $img.tag, $img.size) -ForegroundColor Yellow
}
Write-Host ""
Write-Host "Will KEEP (live + previous + rollback):" -ForegroundColor Green
foreach ($keep in $KeepIds) {
    Write-Host ("  - {0}" -f $keep) -ForegroundColor Green
}
Write-Host ""

# Safety: refuse to run if any KeepId accidentally collides with an ImagesToRemove id.
foreach ($img in $ImagesToRemove) {
    if ($KeepIds -contains $img.id) {
        Write-Host "REFUSING: $($img.id) is in both the remove list AND the keep list." -ForegroundColor Red
        exit 2
    }
}

Write-Host "----- df -h BEFORE -----" -ForegroundColor Cyan
ssh -i $SshKey "$VMUser@$VMHost" "df -h / | tail -1" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
Write-Host ""

Write-Host "----- docker system df BEFORE -----" -ForegroundColor Cyan
ssh -i $SshKey "$VMUser@$VMHost" "sudo docker system df" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
Write-Host ""

Write-Host "----- Removing images one by one -----" -ForegroundColor Cyan
foreach ($img in $ImagesToRemove) {
    Write-Host ""
    Write-Host "  Removing $($img.id) ($($img.tag))..." -ForegroundColor Yellow
    $out = ssh -i $SshKey "$VMUser@$VMHost" "sudo docker rmi -f $($img.id) 2>&1" 2>&1
    $out | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
}

Write-Host ""
Write-Host "----- docker images AFTER -----" -ForegroundColor Cyan
ssh -i $SshKey "$VMUser@$VMHost" "sudo docker images" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
Write-Host ""

Write-Host "----- docker system df AFTER -----" -ForegroundColor Cyan
ssh -i $SshKey "$VMUser@$VMHost" "sudo docker system df" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
Write-Host ""

Write-Host "----- df -h AFTER -----" -ForegroundColor Cyan
ssh -i $SshKey "$VMUser@$VMHost" "df -h / | tail -1" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
Write-Host ""

Write-Host "----- ATS container still running? -----" -ForegroundColor Cyan
ssh -i $SshKey "$VMUser@$VMHost" "sudo docker ps --filter name=ats-backend" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
Write-Host ""

Write-Host "----- /api/health -----" -ForegroundColor Cyan
ssh -i $SshKey "$VMUser@$VMHost" "curl -sS http://127.0.0.1:8080/api/health" 2>&1 | ForEach-Object { Write-Host "    $_" -ForegroundColor DarkGray }
Write-Host ""

Write-Host "============================================================" -ForegroundColor Green
Write-Host "  Group A cleanup complete." -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green

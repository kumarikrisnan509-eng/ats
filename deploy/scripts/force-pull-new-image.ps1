param(
    [string]$VMHost = "141.148.192.4",
    [string]$VMUser = "ubuntu",
    [string]$SshKey = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key"
)
$ErrorActionPreference = "Continue"

# Use the new commit SHA so we definitely pick up the broker fix
$NewTag = "b06ab0a"

$bashScript = @'
#!/usr/bin/env bash
set -uo pipefail

NEW_TAG="__NEW_TAG__"
ENV_COMPOSE=/opt/ats/compose/.env
COMPOSE_DIR=/opt/ats/compose

echo "============================================================"
echo "  Pin compose to the new image SHA and force-pull"
echo "============================================================"
echo "--- Current /opt/ats/compose/.env ---"
sudo cat "$ENV_COMPOSE"
echo
echo "--- Current /opt/ats/compose/.current-tag (set by deploy.yml) ---"
sudo cat /opt/ats/compose/.current-tag 2>&1 || echo "(no file)"
echo
echo "--- Pinning ATS_IMAGE_TAG=$NEW_TAG ---"
sudo bash -c "cat > $ENV_COMPOSE" <<EOF
ATS_REPO_OWNER=kumarikrisnan509-eng
ATS_IMAGE_TAG=$NEW_TAG
EOF
sudo cat "$ENV_COMPOSE"

echo
echo "============================================================"
echo "  docker compose pull (force fresh image)"
echo "============================================================"
cd "$COMPOSE_DIR"
sudo docker compose --env-file "$ENV_COMPOSE" pull 2>&1

echo
echo "============================================================"
echo "  Verify the new image has the fix (no throw at line 101)"
echo "============================================================"
sudo docker run --rm "ghcr.io/kumarikrisnan509-eng/ats-backend:$NEW_TAG" sh -c "grep -A 2 'async start' /app/brokers/zerodha-broker.js | head -10"

echo
echo "============================================================"
echo "  down + up -d with the new image"
echo "============================================================"
sudo docker compose --env-file "$ENV_COMPOSE" down 2>&1
sudo docker compose --env-file "$ENV_COMPOSE" up -d 2>&1

echo
echo "  waiting 15s..."
sleep 15

echo
echo "============================================================"
echo "  /api/health response"
echo "============================================================"
curl -sS --max-time 5 http://127.0.0.1:8080/api/health 2>&1
echo

echo
echo "============================================================"
echo "  Image tag actually running:"
echo "============================================================"
sudo docker inspect ats-backend --format '{{.Config.Image}}' 2>&1
echo
echo "  Last 10 lines of backend logs:"
sudo docker logs --tail 10 ats-backend 2>&1
'@

$bashScript = $bashScript.Replace('__NEW_TAG__', $NewTag)

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$OutFile     = Join-Path $ProjectRoot "deploy\.force-pull-output.txt"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Force-pull new image and start with the broker fix" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$bashScript | ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object {
    Write-Host "    $_" -ForegroundColor DarkGray
}

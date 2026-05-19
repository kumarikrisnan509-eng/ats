param(
    [string]$VMHost = "141.148.192.4",
    [string]$VMUser = "ubuntu",
    [string]$SshKey = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key"
)
$ErrorActionPreference = "Continue"

$NewTag = "bd1175251e6b"
$GhcrPat = $env:GH_PAT
$RepoOwner = "mohanapriya63085"

$bashScript = @'
#!/usr/bin/env bash
set -uo pipefail

NEW_TAG="__NEW_TAG__"
OWNER="__OWNER__"
PAT="__PAT__"
ENV_COMPOSE=/opt/ats/compose/.env

echo "============================================================"
echo "  STEP 1: docker login to GHCR (needed for pull)"
echo "============================================================"
echo "$PAT" | sudo docker login ghcr.io -u "$OWNER" --password-stdin

echo
echo "============================================================"
echo "  STEP 2: Pin ATS_IMAGE_TAG=$NEW_TAG in /opt/ats/compose/.env"
echo "============================================================"
sudo bash -c "cat > $ENV_COMPOSE" <<EOF
ATS_REPO_OWNER=$OWNER
ATS_IMAGE_TAG=$NEW_TAG
EOF
sudo cat $ENV_COMPOSE
echo $NEW_TAG | sudo tee /opt/ats/compose/.current-tag > /dev/null

echo
echo "============================================================"
echo "  STEP 3: docker compose down + up -d (force re-read .env)"
echo "============================================================"
cd /opt/ats/compose
sudo docker compose --env-file $ENV_COMPOSE down 2>&1 | tail -3
sudo docker compose --env-file $ENV_COMPOSE up -d 2>&1
echo "  waiting 10s for boot..."
sleep 10

echo
echo "============================================================"
echo "  STEP 4: Verify image + new route present"
echo "============================================================"
sudo docker inspect ats-backend --format '{{.Config.Image}}' 2>&1
echo
echo "  Test /auto-login/bundle (expect 403 = route exists + protected):"
curl -sS -o /tmp/test.json -w '  status=%{http_code}\n' http://127.0.0.1:8080/api/brokers/zerodha/auto-login/bundle
echo "  body: $(cat /tmp/test.json)"

echo
echo "============================================================"
echo "  STEP 5: Run smoke test (drives Kite UI for real)"
echo "============================================================"
sudo -H node /opt/ats/scripts/auto-login-host.js 2>&1 | tail -30
echo
sleep 3

echo
echo "============================================================"
echo "  STEP 6: Final /api/health"
echo "============================================================"
curl -sS http://127.0.0.1:8080/api/health | python3 -m json.tool
'@

$bashScript = $bashScript.Replace('__NEW_TAG__', $NewTag)
$bashScript = $bashScript.Replace('__OWNER__',   $RepoOwner)
$bashScript = $bashScript.Replace('__PAT__',     $GhcrPat)

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$OutFile     = Join-Path $ProjectRoot "deploy\.fix-image-output.txt"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Fix image tag + re-run smoke test" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$bashScript | ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object {
    Write-Host "    $_" -ForegroundColor DarkGray
}

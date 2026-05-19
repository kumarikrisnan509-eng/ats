param(
    [string]$VMHost = "141.148.192.4",
    [string]$VMUser = "ubuntu",
    [string]$SshKey = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key"
)
$ErrorActionPreference = "Continue"

# The PAT has read:packages scope (we added it earlier for GHCR pulls)
$GhcrPat = $env:GH_PAT
$RepoOwner = "mohanapriya63085"
$NewTag    = "b06ab0ab437f"

# Zerodha creds
$ZerodhaApiKey      = "wmwxx7gys47dfgda"
$ZerodhaApiSecret   = "zer8drtssgwz98p93unb7rudvlnr4zhk"
$ZerodhaRedirectUrl = "https://ats.rajasekarselvam.com/api/brokers/zerodha/callback"
$SessionSecret      = "wS6d4T0iYQGkB3CXEnLHoEwqOQ19Y9kEMPx5HJ5WVkA="

$bashScript = @'
#!/usr/bin/env bash
set -uo pipefail

GHCR_TOKEN="__GHCR_PAT__"
OWNER="__REPO_OWNER__"
TAG="__NEW_TAG__"
IMAGE="ghcr.io/${OWNER}/ats-backend"

ZK="__ZK__"
ZS="__ZS__"
ZR="__ZR__"
SS="__SS__"

ENV_HOST=/etc/ats/backend.env
ENV_COMPOSE=/opt/ats/compose/.env
COMPOSE_DIR=/opt/ats/compose

echo "============================================================"
echo "  STEP 1: docker login to GHCR"
echo "============================================================"
echo "$GHCR_TOKEN" | sudo docker login ghcr.io -u "$OWNER" --password-stdin
echo

echo "============================================================"
echo "  STEP 2: Local cache check + pull ${IMAGE}:${TAG} if missing"
echo "============================================================"
if sudo docker image ls | grep -q "ats-backend.*${TAG}"; then
    echo "  Already in local cache"
else
    sudo docker pull "${IMAGE}:${TAG}"
fi
echo
echo "--- Local ats-backend images ---"
sudo docker image ls | grep ats-backend | head -5

echo
echo "============================================================"
echo "  STEP 3: Verify new image has the fix"
echo "============================================================"
sudo docker run --rm "${IMAGE}:${TAG}" sh -c "grep -A 3 'async start' /app/brokers/zerodha-broker.js | head -8"

echo
echo "============================================================"
echo "  STEP 4: Write backend.env (BROKER=zerodha + correct var names)"
echo "============================================================"
sudo cp -a "$ENV_HOST" "$ENV_HOST.bak-recover-$(date +%s)" 2>/dev/null || true
sudo bash -c "cat > $ENV_HOST" <<EOF
# ATS backend runtime config
ENV_NAME=prod
PORT=8080
KILL_SWITCH=true
AUDIT_LOG=/var/log/ats/audit.log
MAX_WS_CLIENTS=200
DEFAULT_SYMBOLS=NIFTY 50,BANKNIFTY,RELIANCE,HDFCBANK,TCS,INFY
MASTER_KEY_PATH=/run/secrets/master.key
TOKENS_DIR=/var/lib/ats/tokens
SESSION_SECRET=$SS
BROKER=zerodha
ZERODHA_API_KEY=$ZK
ZERODHA_API_SECRET=$ZS
ZERODHA_REDIRECT_URL=$ZR
EOF
sudo chown root:ats "$ENV_HOST"
sudo chmod 0640 "$ENV_HOST"

echo
echo "============================================================"
echo "  STEP 5: Pin ATS_IMAGE_TAG=${TAG} in compose .env"
echo "============================================================"
sudo bash -c "cat > $ENV_COMPOSE" <<EOF
ATS_REPO_OWNER=$OWNER
ATS_IMAGE_TAG=$TAG
EOF
sudo cat "$ENV_COMPOSE"
echo $TAG | sudo tee /opt/ats/compose/.current-tag > /dev/null

echo
echo "============================================================"
echo "  STEP 6: docker compose down + up -d"
echo "============================================================"
cd "$COMPOSE_DIR"
sudo docker compose --env-file "$ENV_COMPOSE" down 2>&1 | tail -5
sudo docker compose --env-file "$ENV_COMPOSE" up -d 2>&1

echo
echo "  waiting 15s for boot..."
sleep 15

echo
echo "============================================================"
echo "  STEP 7: /api/health (expect broker.name=zerodha, connected=false until OAuth)"
echo "============================================================"
HEALTH=$(curl -sS --max-time 5 http://127.0.0.1:8080/api/health 2>&1)
echo "  health: $HEALTH"

echo
echo "  Image running:"
sudo docker inspect ats-backend --format '{{.Config.Image}}' 2>&1
echo
echo "  Last 15 log lines:"
sudo docker logs --tail 15 ats-backend 2>&1 | sed 's/^/    /'

if echo "$HEALTH" | grep -q "\"name\":\"zerodha\""; then
    echo
    echo "============================================================"
    echo "  SUCCESS"
    echo "============================================================"
    echo "  Next: do user OAuth (one-time) in your laptop browser:"
    echo "    https://ats.rajasekarselvam.com/api/brokers/zerodha/login"
    echo "  Sign in with Kite (ARS209), TOTP, Allow."
    echo "  Then /api/health -> broker.connected=true, tickerInitialized=true"
fi
'@

$bashScript = $bashScript.Replace('__GHCR_PAT__',  $GhcrPat)
$bashScript = $bashScript.Replace('__REPO_OWNER__', $RepoOwner)
$bashScript = $bashScript.Replace('__NEW_TAG__',    $NewTag)
$bashScript = $bashScript.Replace('__ZK__',         $ZerodhaApiKey)
$bashScript = $bashScript.Replace('__ZS__',         $ZerodhaApiSecret)
$bashScript = $bashScript.Replace('__ZR__',         $ZerodhaRedirectUrl)
$bashScript = $bashScript.Replace('__SS__',         $SessionSecret)

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$OutFile     = Join-Path $ProjectRoot "deploy\.recover-output.txt"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Recover + flip to BROKER=zerodha on new image $NewTag" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$bashScript | ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object {
    Write-Host "    $_" -ForegroundColor DarkGray
}

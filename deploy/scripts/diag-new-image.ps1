param(
    [string]$VMHost = "141.148.192.4",
    [string]$VMUser = "ubuntu",
    [string]$SshKey = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key"
)
$ErrorActionPreference = "Continue"

$bashScript = @'
#!/usr/bin/env bash
set -uo pipefail

echo "==> Local docker images:"
sudo docker image ls | grep ats-backend | head -5

echo
echo "==> Current container (running OLD image due to rollback):"
sudo docker inspect ats-backend --format '{{.Config.Image}}' 2>&1

echo
echo "==> Try the NEW image directly and see what happens:"
NEW_TAG=$(curl -sS -H "Authorization: Bearer $GH_PAT" "https://api.github.com/repos/kumarikrisnan509-eng/ats/actions/runs?per_page=1" 2>/dev/null | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['workflow_runs'][0]['head_sha'][:12])" 2>/dev/null)
echo "  newer SHA: $NEW_TAG"
NEW_IMAGE="ghcr.io/kumarikrisnan509-eng/ats-backend:${NEW_TAG}"
echo
echo "==> Inspecting new image (was the build pushed?):"
sudo docker image ls --filter=reference="ghcr.io/kumarikrisnan509-eng/ats-backend:*" --format '{{.Repository}}:{{.Tag}}  size={{.Size}}  created={{.CreatedAt}}' | head -5

echo
echo "==> Pulling and inspecting the new image's metadata:"
sudo docker pull "$NEW_IMAGE" 2>&1 | tail -3
sudo docker inspect "$NEW_IMAGE" --format 'User={{.Config.User}} Cmd={{.Config.Cmd}} Entrypoint={{.Config.Entrypoint}}' 2>&1

echo
echo "==> Try running the new image standalone (just to see startup logs):"
sudo docker run --rm --name ats-test-${RANDOM} \
    --entrypoint /usr/bin/tini \
    -e BROKER=mock \
    -e PORT=8080 \
    "$NEW_IMAGE" \
    -- node -e "console.log('node version:', process.version); console.log('cwd:', process.cwd()); console.log('Loading modules...'); try { require('./notify'); console.log('  notify OK'); } catch(e) { console.log('  notify FAIL:', e.message); } try { require('./login-vault'); console.log('  login-vault OK'); } catch(e) { console.log('  login-vault FAIL:', e.message); } try { require('./brokers/zerodha-auto-login'); console.log('  zerodha-auto-login OK'); } catch(e) { console.log('  zerodha-auto-login FAIL:', e.message); } try { require('playwright'); console.log('  playwright OK'); } catch(e) { console.log('  playwright FAIL:', e.message); } try { require('otplib'); console.log('  otplib OK'); } catch(e) { console.log('  otplib FAIL:', e.message); }" 2>&1 | tail -20

echo
echo "==> Or try a server boot (will quit if it errors fast):"
sudo timeout 8 docker run --rm --name ats-test2-${RANDOM} \
    -e BROKER=mock \
    -e PORT=8080 \
    -e KILL_SWITCH=true \
    -e AUDIT_LOG=/tmp/audit.log \
    "$NEW_IMAGE" 2>&1 | tail -25 || true
'@

# Substitute the PAT
$bashScript = $bashScript.Replace('$GH_PAT', $env:GH_PAT)

$ScriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectRoot = (Resolve-Path (Join-Path $ScriptDir "..\..")).Path
$OutFile     = Join-Path $ProjectRoot "deploy\.diag-new-image-output.txt"

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  Diagnose why new Playwright image fails health check" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$bashScript | ssh -i $SshKey "${VMUser}@${VMHost}" "bash -s" 2>&1 | Tee-Object -FilePath $OutFile | ForEach-Object {
    Write-Host "    $_" -ForegroundColor DarkGray
}

#!/usr/bin/env bash
# deploy.sh
#
# Push app files to the Oracle Cloud VM.
# Usage (from the rajasekarselvam.com/ folder on your laptop):
#   bash deploy/scripts/deploy.sh opc@203.0.113.42
#
# What it does:
#   1) rsync static site (app.html, styles.css, src/) to /var/www/rajasekarselvam.com/
#   2) rsync backend/ to /opt/ats/backend/
#   3) npm install --omit=dev  on the server
#   4) systemctl restart ats-backend
#   5) nginx -t && systemctl reload nginx
#
# Prereqs on the server: setup-oracle-linux.sh has already run.

set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "usage: $0 <ssh-user@host> [domain]"
    echo "e.g.:  $0 opc@203.0.113.42 rajasekarselvam.com"
    exit 1
fi

REMOTE="$1"
DOMAIN="${2:-rajasekarselvam.com}"

SCRIPT_DIR="$( cd -- "$( dirname -- "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$( cd "${SCRIPT_DIR}/../.." && pwd )"

echo "==> Project root: ${PROJECT_ROOT}"
echo "==> Remote:       ${REMOTE}"
echo "==> Domain:       ${DOMAIN}"

# 1) Static site
echo "==> [1/5] Syncing static site to /var/www/${DOMAIN}/"
rsync -az --delete \
    --exclude 'deploy' \
    --exclude 'uploads' \
    --exclude 'screenshots' \
    --exclude 'debug.png' \
    --exclude '.git' \
    "${PROJECT_ROOT}/app.html" \
    "${PROJECT_ROOT}/styles.css" \
    "${REMOTE}:/tmp/ats-static/"

rsync -az --delete "${PROJECT_ROOT}/src/" "${REMOTE}:/tmp/ats-static-src/"

ssh "${REMOTE}" "
    set -e
    sudo rsync -a --delete /tmp/ats-static/ /var/www/${DOMAIN}/
    sudo rsync -a --delete /tmp/ats-static-src/ /var/www/${DOMAIN}/src/
    sudo chown -R root:root /var/www/${DOMAIN}
    sudo find /var/www/${DOMAIN} -type d -exec chmod 755 {} \;
    sudo find /var/www/${DOMAIN} -type f -exec chmod 644 {} \;
    sudo restorecon -R /var/www/${DOMAIN} 2>/dev/null || true
    rm -rf /tmp/ats-static /tmp/ats-static-src
"

# 2) Backend
echo "==> [2/5] Syncing backend to /opt/ats/backend/"
rsync -az --delete \
    --exclude 'node_modules' \
    --exclude '.env' \
    --exclude 'audit.log' \
    "${PROJECT_ROOT}/deploy/backend/" "${REMOTE}:/tmp/ats-backend/"

ssh "${REMOTE}" "
    set -e
    sudo rsync -a --delete --exclude node_modules --exclude audit.log /tmp/ats-backend/ /opt/ats/backend/
    sudo chown -R ats:ats /opt/ats/backend
    rm -rf /tmp/ats-backend
"

# 3) npm install on server
echo "==> [3/5] npm install on server"
ssh "${REMOTE}" "cd /opt/ats/backend && sudo -u ats npm install --omit=dev"

# 4) Restart backend
echo "==> [4/5] Restarting ats-backend"
ssh "${REMOTE}" "sudo systemctl restart ats-backend || sudo systemctl start ats-backend"
ssh "${REMOTE}" "sudo systemctl --no-pager --full status ats-backend | head -20"

# 5) Reload Nginx
echo "==> [5/5] Reloading Nginx"
ssh "${REMOTE}" "sudo nginx -t && sudo systemctl reload nginx"

echo ""
echo "==> Done. Verify:"
echo "    curl -I https://${DOMAIN}/"
echo "    curl    https://${DOMAIN}/api/health"

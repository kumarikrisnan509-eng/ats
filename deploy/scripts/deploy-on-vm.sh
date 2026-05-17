#!/usr/bin/env bash
# deploy-on-vm.sh — runs ON the Oracle Cloud VM, invoked by GitHub Actions over SSH.
#
# Args:
#   $1 = image tag (sha-shortened or 'latest')
#   $2 = repo owner (so we can build ghcr.io/<owner>/ats-backend:<tag>)
#
# What it does:
#   1) docker login to GHCR using ATS_GHCR_TOKEN (env)
#   2) docker pull ghcr.io/<owner>/ats-backend:<tag>
#   3) Extract static files out of the image -> /var/www/rajasekarselvam.com/
#   4) docker compose up -d  (with image tag pinned)
#   5) wait for /api/health to return 200
#   6) on failure, roll back to the previous image tag stored in /opt/ats/compose/.previous-tag

set -euo pipefail

NEW_TAG="${1:?missing image tag}"
OWNER="${2:?missing repo owner}"

COMPOSE_DIR="/opt/ats/compose"
STATIC_DIR="/var/www/ats.rajasekarselvam.com"
IMAGE="ghcr.io/${OWNER}/ats-backend"
TAG_FILE="${COMPOSE_DIR}/.current-tag"
PREV_FILE="${COMPOSE_DIR}/.previous-tag"
HEALTH_URL="http://127.0.0.1:8080/api/health"

cd "${COMPOSE_DIR}"

echo "==> Logging in to GHCR"
echo "${ATS_GHCR_TOKEN}" | docker login ghcr.io -u "${OWNER}" --password-stdin >/dev/null

echo "==> Pulling ${IMAGE}:${NEW_TAG}"
docker pull "${IMAGE}:${NEW_TAG}"

echo "==> Extracting baked-in static files to ${STATIC_DIR}"
TMP_CNTR="ats-extract-$$"
docker create --name "${TMP_CNTR}" "${IMAGE}:${NEW_TAG}" >/dev/null
# Create .new owned by deployer so docker cp (running via deployer's docker group) can write into it.
sudo rm -rf "${STATIC_DIR}.new"
sudo mkdir -p "${STATIC_DIR}.new"
sudo chown -R deployer:deployer "${STATIC_DIR}.new"
docker cp "${TMP_CNTR}:/app/static/." "${STATIC_DIR}.new/"
docker rm "${TMP_CNTR}" >/dev/null
# Atomic swap.
if [[ -d "${STATIC_DIR}" ]]; then sudo mv "${STATIC_DIR}" "${STATIC_DIR}.old"; fi
sudo mv "${STATIC_DIR}.new" "${STATIC_DIR}"
# Make files world-readable for Nginx.
find "${STATIC_DIR}" -type d -exec chmod 755 {} + 2>/dev/null || true
find "${STATIC_DIR}" -type f -exec chmod 644 {} + 2>/dev/null || true

# Remember the tag we are switching from so we can roll back if health fails.
if [[ -f "${TAG_FILE}" ]]; then cp "${TAG_FILE}" "${PREV_FILE}"; fi
echo "${NEW_TAG}" > "${TAG_FILE}"

echo "==> docker compose up -d (tag=${NEW_TAG})"
export ATS_IMAGE_TAG="${NEW_TAG}"
export ATS_REPO_OWNER="${OWNER}"
docker compose up -d --remove-orphans

echo "==> Reloading Nginx (in case new static files changed)"
sudo nginx -t && sudo systemctl reload nginx

echo "==> Health check"
ok=0
for i in $(seq 1 30); do
    sleep 2
    if curl -sf "${HEALTH_URL}" >/dev/null; then ok=1; break; fi
    echo "    ...attempt ${i}, not ready yet"
done
if [[ ${ok} -ne 1 ]]; then
    echo "==> Container logs (last 50 lines) for diagnosis:"
    docker logs --tail 50 ats-backend 2>&1 || true
    echo "==> Container ps:"
    docker ps -a --filter name=ats-backend
fi

if [[ ${ok} -ne 1 ]]; then
    echo "!! Health check failed after 20 s. Rolling back."
    if [[ -f "${PREV_FILE}" ]]; then
        PREV_TAG="$(cat "${PREV_FILE}")"
        echo "==> Rolling back to ${PREV_TAG}"
        export ATS_IMAGE_TAG="${PREV_TAG}"
        docker compose up -d
        # Static rollback too.
        if [[ -d "${STATIC_DIR}.old" ]]; then
            sudo rm -rf "${STATIC_DIR}"
            sudo mv "${STATIC_DIR}.old" "${STATIC_DIR}"
            sudo nginx -t && sudo systemctl reload nginx
        fi
        echo "${PREV_TAG}" > "${TAG_FILE}"
    fi
    exit 1
fi

echo "==> Cleanup old static dir"
sudo rm -rf "${STATIC_DIR}.old" || true

echo "==> Cleanup dangling images (keep last 3)"
docker image prune -f --filter "until=168h" >/dev/null || true

echo "==> Ensure host-side auto-login cron is 7 days/week"
# Idempotent: rewrite the file every deploy so it self-heals if anyone fiddled with it.
# 20 3 * * * = 03:20 UTC = 08:50 IST. Mon-Fri restriction (1-5) dropped — Kite tokens
# expire daily regardless of trading day, and weekend re-auth keeps holdings + paper
# trades + Brokers card all green. ~30s of Playwright per day; no Kite rate-limit
# concern at once-per-day from a stable IP.
sudo tee /etc/cron.d/ats-auto-login >/dev/null <<EOF
# ATS daily Zerodha auto-login (managed by deploy/scripts/deploy-on-vm.sh)
# Schedule: 03:20 UTC = 08:50 IST, daily. The Mon-Fri filter was dropped in May 2026
# so weekend logins keep the access token fresh — useful for portfolio review,
# paper trading, and reconciliation on non-trading days.
20 3 * * * root /usr/local/bin/ats-morning-check.sh >> /var/log/ats-morning-check.log 2>&1
EOF
sudo chmod 0644 /etc/cron.d/ats-auto-login
sudo touch /var/log/ats-morning-check.log
sudo chmod 0644 /var/log/ats-morning-check.log

echo "==> Deploy OK: ${IMAGE}:${NEW_TAG}"

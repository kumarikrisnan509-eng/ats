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
sudo rm -rf "${STATIC_DIR}.new"
sudo mkdir -p "${STATIC_DIR}.new"
docker cp "${TMP_CNTR}:/app/static/." "${STATIC_DIR}.new/"
docker rm "${TMP_CNTR}" >/dev/null
# Atomic swap of the static directory.
if [[ -d "${STATIC_DIR}" ]]; then sudo mv "${STATIC_DIR}" "${STATIC_DIR}.old"; fi
sudo mv "${STATIC_DIR}.new" "${STATIC_DIR}"
sudo chown -R root:root "${STATIC_DIR}"
sudo find "${STATIC_DIR}" -type d -exec chmod 755 {} \;
sudo find "${STATIC_DIR}" -type f -exec chmod 644 {} \;
sudo restorecon -Rq "${STATIC_DIR}" 2>/dev/null || true

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
for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 2
    if curl -sf "${HEALTH_URL}" >/dev/null; then ok=1; break; fi
    echo "    ...attempt ${i}, not ready yet"
done

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

echo "==> Deploy OK: ${IMAGE}:${NEW_TAG}"

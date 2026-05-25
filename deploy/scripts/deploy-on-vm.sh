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

# T-177: write tag + owner into /opt/ats/compose/.env so docker-compose actually
# picks them up. Previous behavior relied on `export` but docker-compose's .env
# file takes precedence over shell env in some setups, which is how the VM ended
# up frozen on a stale image from the old GHCR namespace for ~6 months.
ENV_FILE="${COMPOSE_DIR}/.env"
touch "${ENV_FILE}"

# Surgical rewrite: replace the line if it exists, else append. Preserve every
# other line (notably ANTHROPIC_API_KEY and any future secrets).
upsert_env_var() {
    local key="$1"
    local value="$2"
    if grep -qE "^${key}=" "${ENV_FILE}"; then
        sed -i "s|^${key}=.*|${key}=${value}|" "${ENV_FILE}"
    else
        echo "${key}=${value}" >> "${ENV_FILE}"
    fi
}
upsert_env_var ATS_REPO_OWNER "${OWNER}"
upsert_env_var ATS_IMAGE_TAG  "${NEW_TAG}"
chmod 640 "${ENV_FILE}"

# Still export for safety so any tool that reads the shell env (vs the .env
# file) sees the same values.
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

# T-201 (CODE-AUDIT E.11 #5): on success, append the new tag to .last-good-tags
# so deploy/scripts/rollback-on-vm.sh has more than 1 historical option.
# Dedupe + cap at 5 most-recent entries. This runs BEFORE the rollback branch
# so a failed deploy does NOT pollute the history.
if [[ "${ok}" -eq 1 ]]; then
    HISTORY_FILE="${COMPOSE_DIR}/.last-good-tags"
    touch "${HISTORY_FILE}"
    # Prepend NEW_TAG, dedupe, keep top 5.
    {
        echo "${NEW_TAG}"
        grep -v "^${NEW_TAG}$" "${HISTORY_FILE}" || true
    } | head -n 5 > "${HISTORY_FILE}.tmp"
    mv "${HISTORY_FILE}.tmp" "${HISTORY_FILE}"
    echo "==> recorded ${NEW_TAG} in .last-good-tags (top 5)"
fi

if [[ ${ok} -ne 1 ]]; then
    echo "==> Container logs (last 50 lines) for diagnosis:"
    docker logs --tail 50 ats-backend 2>&1 || true
    echo "==> Container ps:"
    docker ps -a --filter name=ats-backend
fi

if [[ ${ok} -ne 1 ]]; then
    echo "!! Health check failed after 20 s. Rolling back."
    # T-418 (production-readiness audit, infra fix #1):
    # Prefer .last-good-tags (only written on SUCCESS, capped at 5 entries)
    # over .previous-tag (overwritten EVERY deploy, including bad ones).
    # Failure scenario: deploy script crashes mid-health-check AFTER
    # .previous-tag was overwritten with the bad new tag -- next deploy
    # would then "roll back" to the broken tag. .last-good-tags is
    # append-only on success, so head -n1 is always the most-recent
    # KNOWN-good tag.
    PREV_TAG=""
    HISTORY_FILE="${COMPOSE_DIR}/.last-good-tags"
    if [[ -s "${HISTORY_FILE}" ]]; then
        PREV_TAG="$(head -n1 "${HISTORY_FILE}")"
        echo "==> rollback source: .last-good-tags top entry"
    elif [[ -f "${PREV_FILE}" ]]; then
        PREV_TAG="$(cat "${PREV_FILE}")"
        echo "==> rollback source: .previous-tag fallback (no .last-good-tags yet)"
    fi
    if [[ -n "${PREV_TAG}" ]]; then
        echo "==> Rolling back to ${PREV_TAG}"
        # T-177: rollback also has to update .env, not just shell env.
        upsert_env_var ATS_IMAGE_TAG "${PREV_TAG}"
        export ATS_IMAGE_TAG="${PREV_TAG}"
        docker compose up -d
        # Static rollback too.
        if [[ -d "${STATIC_DIR}.old" ]]; then
            sudo rm -rf "${STATIC_DIR}"
            sudo mv "${STATIC_DIR}.old" "${STATIC_DIR}"
            sudo nginx -t && sudo systemctl reload nginx
        fi
        echo "${PREV_TAG}" > "${TAG_FILE}"
    else
        echo "!! No rollback target available (no .last-good-tags, no .previous-tag)"
    fi
    exit 1
fi

# T-418 (production-readiness audit, infra fix #3):
# Post-success deeper smoke probe. /api/health is the "is the process up?"
# check (always returns ok:true unconditionally, used by the auto-rollback
# loop above so init() race conditions don't cause false failures).
# /api/health-deep validates db + vault + brokerResolver + broker + every
# data-feeder singleton. We probe it AFTER the rollback gate -- a non-2xx
# here doesn't roll back (false-positive risk during init settling) but
# DOES surface a warning so the operator can investigate.
if curl -sf "http://127.0.0.1:8080/api/health-deep" -o /tmp/health-deep.$$.json; then
    DEEP_OK=$(python3 -c "import json; print(json.load(open('/tmp/health-deep.$$.json')).get('ok'))" 2>/dev/null || echo "?")
    if [[ "${DEEP_OK}" != "True" ]]; then
        echo "!! warn: /api/health-deep returned ok=${DEEP_OK} (deploy NOT rolled back -- /api/health is the rollback gate)"
        python3 -c "import json; d=json.load(open('/tmp/health-deep.$$.json'));  [print('   FAIL: '+k+'='+repr(v)) for k,v in d.get('checks',{}).items() if v is False]" 2>/dev/null || true
    else
        echo "==> /api/health-deep ok"
    fi
    rm -f /tmp/health-deep.$$.json
else
    echo "!! warn: /api/health-deep probe failed (curl error). Container is still up per /api/health."
fi

echo "==> Cleanup old static dir"
sudo rm -rf "${STATIC_DIR}.old" || true

echo "==> Cleanup dangling images (keep last 3)"
docker image prune -f --filter "until=168h" >/dev/null || true

# Note: /etc/cron.d/ats-auto-login fires morning-check.sh at 08:50 IST 7 days/week (T-31).
# The backend cron-reauth.js scheduler (now 7-day) handles the weekend reauths
# that the host-side cron skips. Both writing to cron_history is harmless — the
# scheduler dedupes by date_key so we never double-fire on the same day.

echo "==> Deploy OK: ${IMAGE}:${NEW_TAG}"

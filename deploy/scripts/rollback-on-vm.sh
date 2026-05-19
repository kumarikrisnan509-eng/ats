#!/usr/bin/env bash
# rollback-on-vm.sh -- T-201 (CODE-AUDIT E.11 #5): operator-friendly manual rollback.
#
# deploy-on-vm.sh tracks the last 5 successfully-deployed image tags in
# /opt/ats/compose/.last-good-tags (newline-delimited, most recent first,
# deduped, capped). This script lets the operator pick a known-good tag
# and apply it without remembering docker compose semantics.
#
# Usage (on the VM, as `deployer`):
#   ./rollback-on-vm.sh                 # show the last 5 good tags + current
#   ./rollback-on-vm.sh --previous      # roll back to the tag in .previous-tag
#   ./rollback-on-vm.sh <sha-prefix>    # roll back to a specific tag (matches prefix)
#   ./rollback-on-vm.sh --last-good     # roll back to .last-good-tags line 1
#
# Why this exists:
#   The audit (E.11 #5) flagged that the only rollback path documented today
#   is an inline `docker pull` + `docker compose up -d` in INCIDENT-RUNBOOK.md.
#   Operators must remember the previous SHA from memory or git log. This
#   script makes the choice explicit + safe.

set -euo pipefail

COMPOSE_DIR="${COMPOSE_DIR:-/opt/ats/compose}"
TAG_FILE="${COMPOSE_DIR}/.current-tag"
PREV_FILE="${COMPOSE_DIR}/.previous-tag"
HISTORY_FILE="${COMPOSE_DIR}/.last-good-tags"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8080/api/health}"
OWNER="${ATS_REPO_OWNER:-kumarikrisnan509-eng}"
IMAGE="${IMAGE:-ghcr.io/${OWNER}/ats-backend}"
ENV_FILE="${COMPOSE_DIR}/.env"

# ---- helpers ----
red()    { printf '\033[31m%s\033[0m\n' "$*" >&2; }
green()  { printf '\033[32m%s\033[0m\n' "$*"; }
yellow() { printf '\033[33m%s\033[0m\n' "$*"; }

current_tag() {
    [ -f "$TAG_FILE" ] && cat "$TAG_FILE" || echo "<none>"
}

show_history() {
    yellow "current tag: $(current_tag)"
    if [ -f "$PREV_FILE" ]; then
        yellow "previous tag: $(cat "$PREV_FILE")"
    fi
    if [ -f "$HISTORY_FILE" ]; then
        echo ""
        yellow "last good tags (newest first):"
        nl -ba -w2 -s'. ' "$HISTORY_FILE" | head -5
    else
        yellow "(no .last-good-tags file yet -- deploy-on-vm.sh writes it on success)"
    fi
}

# ---- arg handling ----
TARGET=""
case "${1:-}" in
    ""|--help|-h)
        echo "Usage: $0 [--previous | --last-good | <sha-prefix>]"
        echo ""
        show_history
        exit 0
        ;;
    --previous)
        if [ ! -f "$PREV_FILE" ]; then
            red "ERROR: no .previous-tag file at ${PREV_FILE}. Nothing to roll back to."
            exit 1
        fi
        TARGET=$(cat "$PREV_FILE")
        ;;
    --last-good)
        if [ ! -f "$HISTORY_FILE" ]; then
            red "ERROR: no .last-good-tags file. Use --previous or specify a tag."
            exit 1
        fi
        TARGET=$(head -n1 "$HISTORY_FILE")
        ;;
    *)
        # Treat as sha prefix; match against history.
        if [ -f "$HISTORY_FILE" ] && grep -q "^${1}" "$HISTORY_FILE"; then
            TARGET=$(grep "^${1}" "$HISTORY_FILE" | head -n1)
        else
            # Allow operator to specify an arbitrary tag (e.g. from git log)
            # even if not in history. They take responsibility for verifying
            # the image exists in GHCR.
            TARGET="$1"
            yellow "WARN: tag '${TARGET}' is not in .last-good-tags. Proceeding anyway."
        fi
        ;;
esac

CURRENT=$(current_tag)
if [ "$TARGET" = "$CURRENT" ]; then
    yellow "Target tag '${TARGET}' is already the current tag. Nothing to do."
    exit 0
fi

# ---- confirm ----
echo ""
yellow "About to roll back:"
yellow "  current:  ${CURRENT}"
yellow "  target:   ${TARGET}"
yellow "  image:    ${IMAGE}:${TARGET}"
echo ""
read -p "Proceed? [y/N] " CONFIRM
if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    red "Aborted."
    exit 1
fi

# ---- execute ----
cd "$COMPOSE_DIR"
echo ""
green "==> docker pull ${IMAGE}:${TARGET}"
docker pull "${IMAGE}:${TARGET}"

# Rewrite .env atomically (same pattern as deploy-on-vm.sh T-177).
touch "$ENV_FILE"
upsert_env_var() {
    local key="$1" value="$2"
    if grep -qE "^${key}=" "$ENV_FILE"; then
        sed -i "s|^${key}=.*|${key}=${value}|" "$ENV_FILE"
    else
        echo "${key}=${value}" >> "$ENV_FILE"
    fi
}
upsert_env_var ATS_REPO_OWNER "${OWNER}"
upsert_env_var ATS_IMAGE_TAG  "${TARGET}"
chmod 640 "$ENV_FILE"

export ATS_IMAGE_TAG="${TARGET}"
export ATS_REPO_OWNER="${OWNER}"

# Track what we're switching from so a re-rollback works.
[ -f "$TAG_FILE" ] && cp "$TAG_FILE" "$PREV_FILE"
echo "${TARGET}" > "$TAG_FILE"

green "==> docker compose up -d"
docker compose up -d --remove-orphans

green "==> health check"
ok=0
for i in $(seq 1 30); do
    sleep 2
    if curl -sf "$HEALTH_URL" >/dev/null; then ok=1; break; fi
    echo "    ...attempt ${i}, not ready yet"
done

if [ "$ok" != "1" ]; then
    red "ROLLBACK HEALTH CHECK FAILED. The system is now on ${TARGET}, but /api/health is not responding."
    red "Investigate via 'docker logs ats-backend --tail 200' and consider another rollback target."
    exit 1
fi

green "==> rollback succeeded -- now on ${TARGET}"
echo ""
show_history

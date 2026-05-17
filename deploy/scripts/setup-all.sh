#!/usr/bin/env bash
# ============================================================
#  setup-all.sh — T99-T60 meta-runner.
#
#  Runs every one-time setup script in /opt/ats/scripts/ in the right order.
#  Idempotent: re-running is safe and just re-verifies / re-installs state.
#
#  Use after:
#    - First VM bootstrap (after setup-ubuntu-docker.sh + rclone OAuth done)
#    - Disaster recovery rebuild (per DR-RUNBOOK)
#    - Any time you want to re-assert ALL the periodic infra is wired up
#
#  Each step independently catches its own errors so a failure in one
#  doesn't block the rest. Final summary tells you what worked and what
#  needs attention.
#
#  Usage:
#    sudo /opt/ats/scripts/setup-all.sh
# ============================================================
set -uo pipefail   # NOT -e: we want to continue past per-step failures

if [[ $EUID -ne 0 ]]; then
  echo "ERROR: run as root (sudo bash $0)" >&2
  exit 1
fi

SCRIPTS_DIR="/opt/ats/scripts"

# Each step is a (display_name, script_path) tuple. Order matters:
#   1. nginx first — fastest, no network dependencies
#   2. backup wrapper next — needs nginx not to be blocking
#   3. auto-login cron — depends on morning-check.sh being deployed
#   4. DR cron — runs the test once, which depends on backup having run at least once
STEPS=(
  "nginx config         |${SCRIPTS_DIR}/sync-nginx-config.sh"
  "rclone backup wrapper|${SCRIPTS_DIR}/repair-rclone-wrapper.sh"
  "auto-login cron     |${SCRIPTS_DIR}/setup-auto-login-cron.sh"
  "DR test cron        |${SCRIPTS_DIR}/setup-dr-cron.sh"
)

declare -a RESULTS

for entry in "${STEPS[@]}"; do
  name="${entry%%|*}"
  script="${entry##*|}"
  echo ""
  echo "================================================================"
  echo "==> [$name] $script"
  echo "================================================================"
  if [[ ! -x "$script" ]]; then
    echo "    SKIP: $script not found or not executable"
    RESULTS+=("SKIP   | $name (script missing)")
    continue
  fi
  if "$script"; then
    RESULTS+=("OK     | $name")
  else
    rc=$?
    echo "    !! $name exited $rc — continuing with next step"
    RESULTS+=("FAIL($rc) | $name")
  fi
done

echo ""
echo "================================================================"
echo "  SUMMARY"
echo "================================================================"
for r in "${RESULTS[@]}"; do
  printf '  %s\n' "$r"
done

# Exit non-zero if any step failed so callers (or CI scripts) can detect.
fails=$(printf '%s\n' "${RESULTS[@]}" | grep -c '^FAIL\|^SKIP') || true
if [[ "$fails" -gt 0 ]]; then
  echo ""
  echo "  $fails step(s) need attention — see logs above."
  exit 1
fi

echo ""
echo "  All steps OK. System is fully wired up."
echo ""
echo "Final verification (run on the VM):"
echo "  curl -s https://ats.rajasekarselvam.com/api/status | python3 -m json.tool | grep -E 'ok|state'"

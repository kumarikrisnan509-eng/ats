#!/usr/bin/env bash
# check-email-deliverability.sh — verify SPF / DKIM / DMARC DNS records.
#
# T-161 (v11-I7). Run after adding the three TXT records per
# deploy/docs/EMAIL-DELIVERABILITY.md. Exits 0 if all three are present;
# 1 if any are missing. Designed to be runnable both interactively and
# as a cron health-check.
#
# Usage:
#   ./check-email-deliverability.sh                       # uses rajasekarselvam.com
#   ./check-email-deliverability.sh ats.example.com       # any other domain
#   DKIM_SELECTOR=k1 ./check-email-deliverability.sh      # custom DKIM selector

set -u  # error on unset vars
DOMAIN="${1:-rajasekarselvam.com}"
DKIM_SELECTOR="${DKIM_SELECTOR:-s1}"

# Color escape codes only if stdout is a tty.
if [ -t 1 ]; then
  GREEN=$'\033[0;32m'; RED=$'\033[0;31m'; YELLOW=$'\033[0;33m'; RESET=$'\033[0m'
else
  GREEN=; RED=; YELLOW=; RESET=
fi

ok=0
fail=0

check() {
  local label="$1"
  local query="$2"
  local match="$3"

  local result
  result=$(dig +short TXT "$query" 2>/dev/null | tr -d '"')

  if [ -z "$result" ]; then
    echo "${RED}✗${RESET} $label  ($query)"
    echo "  no TXT record found"
    fail=$((fail + 1))
    return 1
  fi

  if echo "$result" | grep -qiE "$match"; then
    echo "${GREEN}✓${RESET} $label  ($query)"
    echo "  $result" | head -c 200
    echo ""
    ok=$((ok + 1))
    return 0
  else
    echo "${YELLOW}△${RESET} $label  ($query)"
    echo "  TXT record exists but doesn't match expected pattern: $match"
    echo "  $result" | head -c 200
    echo ""
    fail=$((fail + 1))
    return 1
  fi
}

echo "== Email deliverability check for $DOMAIN =="
echo ""

check "SPF"   "$DOMAIN"                              "^v=spf1"
check "DKIM"  "${DKIM_SELECTOR}._domainkey.$DOMAIN"  "^v=DKIM1"
check "DMARC" "_dmarc.$DOMAIN"                       "^v=DMARC1"

echo ""
echo "== summary =="
echo "${GREEN}$ok pass${RESET}, ${RED}$fail fail${RESET}"

if [ "$fail" -gt 0 ]; then
  echo ""
  echo "Next steps:"
  echo "  1. Read deploy/docs/EMAIL-DELIVERABILITY.md"
  echo "  2. Add the missing TXT record(s) at your DNS provider"
  echo "  3. Wait 1-4 hours for propagation; re-run this script"
  echo ""
  echo "If DKIM is missing and you've already configured your mail provider,"
  echo "check the DKIM_SELECTOR env var matches what your provider gave you"
  echo "(default: s1).  e.g.  DKIM_SELECTOR=google ./check-email-deliverability.sh"
  exit 1
fi

echo ""
echo "All three records present.  Recommended next steps:"
echo "  - Send a test signup email to Gmail; verify 'Show original' shows"
echo "    SPF=PASS, DKIM=PASS, DMARC=PASS"
echo "  - Set up the DMARC report mailbox forwarder (rua= address)"
echo "  - After 1-2 weeks of clean reports, upgrade DMARC p=none → p=quarantine"
exit 0

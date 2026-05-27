#!/usr/bin/env bash
# ============================================================
#  check-killswitch-transition.sh — T-480 readiness verifier.
#
#  Runs the 4 verifiable boxes of KILLSWITCH-TRANSITION.md
#  against this VM + the live backend. Prints PASS/FAIL per box.
#  Exits 0 if all boxes pass, non-zero if any fail.
#
#  The 2 boxes this CANNOT check (you do them yourself):
#    - You can SSH from your phone (test it offline)
#    - You'll be at your desk 09:00-15:30 IST for 3 days
#
#  Usage:
#    sudo bash deploy/scripts/check-killswitch-transition.sh
#  or after deploy:
#    sudo /opt/ats/scripts/check-killswitch-transition.sh
# ============================================================
set -uo pipefail

BACKEND_URL="${BACKEND_URL:-https://ats.rajasekarselvam.com}"
PASSPHRASE_PATH="${PASSPHRASE_PATH:-/etc/ats/.backup-passphrase}"
PAPER_MIN_DAYS="${PAPER_MIN_DAYS:-30}"
PAPER_DB="${PAPER_DB:-/var/lib/ats/tokens/ats.db}"

FAILED=0
PASSED=0

pass() { echo "  PASS  $*"; PASSED=$((PASSED + 1)); }
fail() { echo "  FAIL  $*"; FAILED=$((FAILED + 1)); }
info() { echo "  INFO  $*"; }

echo ""
echo "==============================================================="
echo "  KILL_SWITCH transition readiness check"
echo "  Backend: $BACKEND_URL"
echo "  $(date -u +'%Y-%m-%d %H:%M:%S UTC')"
echo "==============================================================="

# ---- Box 1: backup passphrase armed --------------------------------
echo ""
echo "[1/4] Backup passphrase"
if [[ -s "$PASSPHRASE_PATH" ]]; then
    PERM=$(stat -c '%a' "$PASSPHRASE_PATH" 2>/dev/null || echo '???')
    OWNER=$(stat -c '%U:%G' "$PASSPHRASE_PATH" 2>/dev/null || echo '???')
    LEN=$(wc -c < "$PASSPHRASE_PATH" | tr -d ' ')
    if [[ "$PERM" == "400" || "$PERM" == "0400" ]] && [[ "$OWNER" == "root:root" ]] && [[ "$LEN" -ge 32 ]]; then
        pass "$PASSPHRASE_PATH exists, mode $PERM, owner $OWNER, $LEN bytes"
        info "    HAVE YOU saved a copy in your password manager? (this script cannot verify)"
    else
        fail "$PASSPHRASE_PATH exists but perms/length wrong: mode=$PERM owner=$OWNER len=$LEN (want 0400 root:root >=32b)"
    fi
else
    fail "$PASSPHRASE_PATH missing or empty -- run: sudo /opt/ats/scripts/setup-backup-passphrase.sh"
fi

# ---- Box 2: paper-trading day count --------------------------------
echo ""
echo "[2/4] Paper-trading proof (need >= $PAPER_MIN_DAYS distinct calendar days)"
if [[ ! -r "$PAPER_DB" ]]; then
    fail "cannot read $PAPER_DB (run as root or set PAPER_DB env)"
elif ! command -v sqlite3 >/dev/null 2>&1; then
    fail "sqlite3 CLI missing"
else
    # Count distinct calendar days that have a paper trade audit entry.
    # Table name based on paper.js / WORM audit chain in audit-log.
    DISTINCT_DAYS=$(sqlite3 "$PAPER_DB" "SELECT COUNT(DISTINCT DATE(ts/1000, 'unixepoch')) FROM paper_orders;" 2>/dev/null || echo '0')
    if [[ "$DISTINCT_DAYS" =~ ^[0-9]+$ ]] && [[ "$DISTINCT_DAYS" -ge "$PAPER_MIN_DAYS" ]]; then
        pass "$DISTINCT_DAYS distinct trading days of paper activity"
    elif [[ "$DISTINCT_DAYS" =~ ^[0-9]+$ ]]; then
        fail "only $DISTINCT_DAYS days of paper-trading -- need $PAPER_MIN_DAYS more days at killSwitch=true before flipping"
    else
        info "could not count paper-trading days (paper_orders table missing or empty); manual check needed"
    fi

    # Also check P&L sign over the window if possible
    NET_PNL=$(sqlite3 "$PAPER_DB" "SELECT COALESCE(SUM(realized_pnl), 0) FROM paper_orders;" 2>/dev/null || echo 'null')
    info "    cumulative paper realized P&L: ₹$NET_PNL (sign matters: positive = strategy works on paper)"
fi

# ---- Box 3: MAX_DAILY_LOSS_INR set + reasonable --------------------
echo ""
echo "[3/4] MAX_DAILY_LOSS_INR sanity"
HEALTH_JSON=$(curl -fsS "$BACKEND_URL/api/system/info" 2>/dev/null || echo '{}')
MAX_LOSS=$(echo "$HEALTH_JSON" | python3 -c "import sys, json; d=json.load(sys.stdin); print((d.get('components',{}).get('riskCaps') or {}).get('maxDailyLossINR', 0))" 2>/dev/null || echo '0')
KILL_LIVE=$(echo "$HEALTH_JSON" | python3 -c "import sys, json; d=json.load(sys.stdin); print(d.get('killSwitch'), d.get('liveTrading'))" 2>/dev/null || echo '? ?')

if [[ "$MAX_LOSS" -gt 0 ]] && [[ "$MAX_LOSS" -le 100000 ]]; then
    pass "MAX_DAILY_LOSS_INR=₹$MAX_LOSS (within sane personal-account range ₹1-100k)"
    info "    HAVE YOU set Zerodha 'Day's loss limit' in Kite to ≤₹$((MAX_LOSS / 2))?"
    info "    (this script cannot verify Zerodha-side settings)"
elif [[ "$MAX_LOSS" -eq 0 ]]; then
    fail "MAX_DAILY_LOSS_INR is 0 -- daily-loss circuit is INERT. Set in /etc/ats/backend.env"
else
    fail "MAX_DAILY_LOSS_INR=₹$MAX_LOSS is too large for personal-account first-flip. Recommend <₹50k for week 1"
fi

# ---- Box 4: current killSwitch state --------------------------------
echo ""
echo "[4/4] Pre-flight kill-switch state"
echo "  killSwitch / liveTrading currently: $KILL_LIVE"
if [[ "$KILL_LIVE" == "True False" ]]; then
    pass "killSwitch=true, liveTrading=false (expected pre-flip state)"
elif [[ "$KILL_LIVE" == "False True" ]]; then
    info "killSwitch=false, liveTrading=true -- ALREADY FLIPPED. Re-run after re-arming or treat this as a post-flip audit."
else
    fail "unexpected state ($KILL_LIVE) -- backend may be misconfigured"
fi

# ---- Summary -------------------------------------------------------
echo ""
echo "==============================================================="
echo "  $PASSED passed / $FAILED failed (of 4 auto-verifiable boxes)"
echo ""
echo "  Boxes you must verify MANUALLY (this script CANNOT check):"
echo "    [ ] You can SSH to this VM from your phone over mobile data"
echo "        (test it now: disable WiFi, ssh from phone, run 'whoami')"
echo "    [ ] You have rehearsed the killSwitch-flip-back from your phone"
echo "        with a stopwatch. Target: <60 seconds."
echo "    [ ] You will be at your desk 09:00-15:30 IST for the first 3"
echo "        days after flipping. No vacation, no doctor appointments,"
echo "        no school pickup."
echo "    [ ] Paper-trading P&L from box 2 is positive (or you have"
echo "        explicitly accepted negative-EV as a learning cost)."
echo "==============================================================="

if [[ "$FAILED" -gt 0 ]]; then
    echo ""
    echo "STATUS: NOT READY. Fix the FAIL boxes above. Re-run this script."
    exit 1
fi

echo ""
echo "STATUS: 4/4 auto-checks pass. Verify the 4 manual boxes above,"
echo "        then see deploy/docs/KILLSWITCH-TRANSITION.md for the flip command."
exit 0

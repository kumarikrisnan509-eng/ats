# KILL_SWITCH Transition Checklist

**Purpose:** the pre-flight checklist the operator runs BEFORE flipping
`KILL_SWITCH=false` for the first time (or after any extended kill-switched
period). Once `KILL_SWITCH=false`, the backend will route real orders to
Zerodha against your real broker account. Real money moves.

This document is the operator's contract with themselves. If any item fails,
do not flip. Period.

---

## Phase 1 — Capital sizing (do this OFF the production system)

- [ ] You have decided the maximum loss-of-capital you can absorb if every
      strategy goes maximally wrong in the first 24 hours of live trading.
      Write the number down here: ₹ `<FILL IN>`
- [ ] That number is set as `MAX_DAILY_LOSS_INR` in /etc/ats/backend.env
- [ ] It is also set as a Zerodha account-level daily loss cap in Kite Web
      (Settings → Risk → Day's loss limit). Set the Kite limit to **half**
      of `MAX_DAILY_LOSS_INR`. Backend trips first, Zerodha catches anything
      the backend misses.
- [ ] You have ₹0 in the trading account that you cannot afford to lose.
      ATS is not a savings account.

## Phase 2 — System health (run on the VM, all must pass)

```bash
ssh ats-prod
curl -s https://ats.rajasekarselvam.com/api/health-deep | jq '.checks'
```

Verify each is `true`:

- [ ] `db: true`
- [ ] `vault: true`
- [ ] `brokerResolver: true`
- [ ] `broker: true`
- [ ] `surveillance: true` AND `surveillanceAgeMin < 60`
- [ ] `earningsCal: true` AND `earningsCalAgeMin < 1440`
- [ ] `drLastTestOk: true`
- [ ] `drStale: false`
- [ ] `brokerWsConnected: true` AND `brokerTickStale: false`
- [ ] `brokerTickLagSec < 5`
- [ ] `brokerAccessTokenAgeMin < 600` (token less than 10h old)

If any fail, abort. Address each. Re-check.

## Phase 3 — Audit chain integrity

```bash
sudo /opt/ats/scripts/verify-audit-chain.sh --full
```

- [ ] Exit code 0, no chain breaks reported
- [ ] Last entry timestamp is < 5 minutes old
- [ ] Audit log is on the encrypted volume (NOT /tmp, NOT a tmpfs)

## Phase 4 — Backup + DR verified

- [ ] `/etc/ats/.backup-passphrase` exists, mode 0400, root:root
- [ ] The passphrase is saved in your password manager (verify NOW by reading
      it back from your vault, not from the file)
- [ ] Last DR restore test: `sudo grep PASS /var/log/ats/dr-restore-test.log | tail -1`
      ← timestamp within last 35 days
- [ ] rclone remote `ats-archive` lists at least 7 nightly snapshots:
      `rclone ls ats-archive:ats-audit-archive/db-snapshots | wc -l` ≥ 7

## Phase 5 — Security baseline

- [ ] SESSION_SECRET in /etc/ats/backend.env is ≥ 32 chars, not the dev placeholder
- [ ] ZERODHA_API_SECRET in /etc/ats/backend.env is the current secret
      (verify by re-reading it from the Zerodha developer console)
- [ ] All HIGH-severity findings in audit-2026-05-26 are CLOSED or have a
      documented operator-accepted exception
- [ ] HSTS preload header verified live:
      `curl -sI https://ats.rajasekarselvam.com/ | grep -i strict-transport`
- [ ] `/api/health` is reachable; everything else requires auth (verify by
      trying `curl /api/me/portfolio` and confirming 401)

## Phase 6 — Paper trading proof

- [ ] At least 30 consecutive trading days of paper trading on the live
      production system with `KILL_SWITCH=true`
- [ ] Paper-trading WORM audit shows positive expected value OR you have
      explicitly accepted negative expected value as a learning cost
- [ ] No unexplained position-shape drift between Zerodha-reported holdings
      and `/api/me/portfolio/holdings`

## Phase 7 — Operator readiness

- [ ] You have read deploy/docs/INCIDENT-RESPONSE.md end to end in the last
      7 days, even if no incident occurred
- [ ] You can SSH to the VM from your phone (mobile data, not just home Wi-Fi)
- [ ] You can flip KILL_SWITCH back to `true` from your phone in under 60
      seconds (rehearse this with a stopwatch, RIGHT NOW)
- [ ] You will be online and reachable for the entire NSE trading session on
      the first 3 days after flipping (09:00–15:30 IST)
- [ ] You have NOT been awake more than 18 hours when flipping

## The flip

Only if every single box above is checked:

```bash
ssh ats-prod
sudo sed -i 's/KILL_SWITCH=true/KILL_SWITCH=false/' /etc/ats/backend.env
sudo systemctl restart ats-backend

# Verify
sleep 5
curl -s https://ats.rajasekarselvam.com/api/health | jq '.killSwitch,.liveTrading'
# Expected:
#   false
#   true
```

Set a 60-minute reminder. At the first hour mark:
- check `/api/me/portfolio` matches Zerodha Kite UI position-for-position
- check `/api/audit/tail` shows real order audit entries
- check no orders were routed that you did not intend

If anything looks off — even slightly off — flip back immediately:

```bash
sudo sed -i 's/KILL_SWITCH=false/KILL_SWITCH=true/' /etc/ats/backend.env
sudo systemctl restart ats-backend
```

You will lose nothing by being paranoid. You can lose a lot by not being.

---

**Final check:** read this document one more time before flipping. The fact
that you wrote (or are reading) every box does not mean it is checked. The
boxes are checked when you have physically verified them in the last 24
hours, on this VM, today.

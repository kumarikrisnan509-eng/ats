# Incident Response Runbook — ATS Production

**Owner:** Rajasekar Selvam (operator-of-record)
**Last updated:** T-478 (2026-05-27)
**Scope:** ats.rajasekarselvam.com production VM + Zerodha broker integration

This runbook is the source of truth during a production incident. The operator
fills in the `<FILL IN>` placeholders below before going live. Re-read every
quarter and after every Sev-1 incident.

---

## 0. Operator contacts

```
Primary operator       : Rajasekar Selvam (you)
Backup operator        : <FILL IN: name, mobile, email>
Personal phone         : <FILL IN>
Personal email         : rajasekarjavaee@gmail.com
PagerDuty / on-call URL: <FILL IN OR LEAVE BLANK -- single-operator deploy>
```

## 1. Severity classification

| Sev | Trigger | Response time | Examples |
|-----|---------|---------------|----------|
| Sev-1 | Real money at risk OR full outage | Immediate (<5 min) | Order routed wrong, KILL_SWITCH stuck off, broker token leaked, DB corruption, prod 5xx >50% |
| Sev-2 | Degraded but bounded | <30 min | Single endpoint 5xx, ticker stalled, DR backup failed, auto-login daemon down |
| Sev-3 | Cosmetic / non-customer-facing | Next business day | Single screen render bug, slow chart, log noise |

## 2. First 60 seconds — STOP THE BLEED

Before any investigation, if Sev-1:

```bash
# 1. Kill all live orders immediately
sudo systemctl stop ats-backend  # container down
# OR if you cannot SSH:
#   - log into Zerodha Kite web UI manually
#   - cancel any pending orders, square off any open positions

# 2. Verify killSwitch
curl -s https://ats.rajasekarselvam.com/api/health | jq .killSwitch
# Expected: true  -- if false, that is YOUR fault, fix it
```

If you cannot reach the VM at all (Sev-1 + connectivity loss):
- Open Zerodha Kite web UI on phone (https://kite.zerodha.com)
- Manually cancel/square-off everything
- THEN debug the VM

## 3. Common scenarios

### 3a. Container crash / restart loop

```bash
ssh ats-prod
sudo docker logs --tail 200 ats-backend
sudo docker ps -a | grep ats-backend  # check restart count
sudo journalctl -u docker --since '10 min ago' | tail -50

# If genuine OOM:
sudo docker stats --no-stream  # see current memory
# Bump mem_limit in deploy/docker/docker-compose.yml and redeploy

# If oauth-state SESSION_SECRET prod-guard fired (exit 78):
sudo docker logs ats-backend 2>&1 | grep FATAL
# -> check /etc/ats/backend.env has SESSION_SECRET >=32 chars
```

### 3b. Broker disconnected (ticker stale)

```bash
curl -s https://ats.rajasekarselvam.com/api/health | jq '.broker'
# tickStale: true OR lagMs > 10000 = problem

# Force reauth (operator action, not automated):
ssh ats-prod
sudo /opt/ats/scripts/auto-login-host.js  # one-shot reauth
sudo systemctl status ats-auto-login-daemon  # daemon health
```

If the broker access token has expired AND auto-login is broken:
1. Log into Zerodha Kite web manually
2. Generate new request token via OAuth flow at https://ats.rajasekarselvam.com/api/v1/me/brokers/zerodha/actions/reauth-url
3. Complete callback in browser
4. Verify `curl /api/health | jq .broker.hasAccessToken` returns true

### 3c. Suspected unauthorized order

```bash
# Pull the WORM audit chain for the suspicious time window
ssh ats-prod
sudo /opt/ats/scripts/dump-audit-tail.sh --since '2 hours ago' > /tmp/audit-tail.json
sudo /opt/ats/scripts/verify-audit-chain.sh /tmp/audit-tail.json
# If verify FAILS, the audit chain has been tampered with -- treat as
# breach, KILL_SWITCH on, rotate every credential.

# Cross-reference with Zerodha order book
# Manual: log into Kite, export today's order book CSV, compare PIDs
```

### 3d. DR backup failure

```bash
ssh ats-prod
sudo cat /var/log/ats/backup-db-tokens.log | tail -50
# Common causes:
#   - /etc/ats/.backup-passphrase missing  -> run setup-backup-passphrase.sh
#   - rclone remote ats-archive not configured  -> setup-rclone-archive.sh
#   - GDrive quota -> check Google Drive in browser
#   - sqlite3 .backup lock contention -> wait and retry
```

### 3e. KILL_SWITCH unintentionally flipped to false

This should be a Sev-1 even if no orders went out yet:

```bash
ssh ats-prod
# Confirm current state of env file
sudo grep KILL_SWITCH /etc/ats/backend.env
# If = false, flip back:
sudo sed -i 's/KILL_SWITCH=false/KILL_SWITCH=true/' /etc/ats/backend.env
sudo systemctl restart ats-backend
# Verify:
curl -s https://ats.rajasekarselvam.com/api/health | jq .killSwitch  # true

# Audit who/how this changed
sudo grep -r KILL_SWITCH /var/log/auth.log /var/log/syslog
```

## 4. Communication

- Stay calm, even at 3am.
- Update the incident state every 15 min in a private notes file (you are
  the only stakeholder right now, but future-you will read this during the
  postmortem).
- DO NOT publicly tweet / post about an in-flight incident.

## 5. Post-incident (within 48h)

Fill out a blameless postmortem in `deploy/docs/postmortems/YYYY-MM-DD-<slug>.md`:
- Timeline (UTC, minute-by-minute)
- Trigger (what changed?)
- Detection (how did you find out?)
- Mitigation (what stopped the bleed?)
- Resolution (what fixed it?)
- Action items (preventive, with task IDs)

A repeat of the same incident class within 90 days = the action items did not
land. Re-prioritize them.

## 6. Escalation contacts

```
Broker (Zerodha) support     : <FILL IN: support@zerodha.com / phone>
Cloud provider               : <FILL IN: who hosts the VM? Hetzner/AWS/etc.>
Domain registrar             : <FILL IN: who owns rajasekarselvam.com DNS?>
GitHub / Actions admin       : <FILL IN: your GH account email>
SEBI / regulator (if needed) : <FILL IN: only if order routed in error>
Legal counsel                : <FILL IN OR LEAVE BLANK>
```

## 7. Never-skip checklist after any Sev-1

- [ ] killSwitch back on
- [ ] All open positions accounted for (Zerodha UI vs internal /me/portfolio)
- [ ] Audit chain verified
- [ ] DR backup confirmed running
- [ ] All credentials that *might* have leaked rotated:
    - [ ] Zerodha API secret (via Zerodha developer console)
    - [ ] SESSION_SECRET in backend.env
    - [ ] DR_TOKEN in /etc/ats/.dr-token
    - [ ] SSH host keys on the VM
- [ ] Postmortem started in deploy/docs/postmortems/

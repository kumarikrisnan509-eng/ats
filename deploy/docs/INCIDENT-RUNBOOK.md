# ATS Incident Response Runbook

**Last updated:** 2026-05-18 (T-128, v11-I4)
**Audience:** ATS operator (today: rajasekarjavaee@gmail.com / Kite ID ARS209)
**Production endpoint:** https://ats.rajasekarselvam.com
**VM:** Oracle Cloud Ampere A1 (ARM64) at 141.148.192.4 (deployer@)
**Stack:** Docker container `ats-backend` listening on 127.0.0.1:8080, nginx in front

---

## Quick diagnostic — start here every time

```bash
# 1. Is the public site up?
curl -sI https://ats.rajasekarselvam.com/api/health
#   Expect: HTTP/2 200

# 2. Deep health (broker, DR, surveillance, earnings, mf-data)
curl -s https://ats.rajasekarselvam.com/api/health-deep | jq .checks
#   Critical fields:
#     ok                           -> overall green/red
#     brokerWsConnected            -> true = ticker streaming
#     brokerWsStalled              -> true = 3x 403 detector triggered (T-58)
#     brokerAccessTokenAgeMin      -> minutes since last broker.setAccessToken()
#     drStale                      -> false = DR restore-test recent
#     earningsCal / surveillance   -> true = caches warm

# 3. x-request-id is the support correlation key (T-78)
curl -sI https://ats.rajasekarselvam.com/api/auth-mode | grep x-request-id
#   Use the value when querying audit log or errors_log
```

---

## Incident 1: Broker WebSocket stalled / "Token expired" banner

**Symptom:** Brokers screen shows "Token expired Xh ago", "Live data feed: stalled", error banner "kite_TokenException: Token is invalid or has expired".

**Healthy state should be:** brokerWsConnected:true, brokerWsStalled:false, brokerAccessTokenAgeMin<1440.

### Recovery path (in priority order)

#### Option A — Wait for the self-healing reauth (T-114/T-115)
The system auto-recovers within ~15 minutes of any stall thanks to:
- T-115 reactive trigger fires `cron-reauth.runNow()` within seconds of 3rd 403
- T-114 retry chain at +15min/+30min/+60min/+2h/+4h
- T-116 multi-window schedule at 05:45/09:00/13:00 IST

If the system fails to self-heal within 30 minutes, escalate to option B.

#### Option B — Manual reauth via Brokers screen UI
1. Open https://ats.rajasekarselvam.com → Brokers card
2. Click **Manual reauth** button
3. Kite OAuth popup opens; complete 2FA in your browser
4. The callback handler at `/api/v1/oauth/zerodha/callback`:
   - Calls `broker.exchangeRequestToken()` to get access_token
   - Calls `broker.setAccessToken()` (in-memory broker resumes)
   - Calls `sessions.saveTokens()` (file refreshed)
   - T-118/T-119: writes to `broker_accounts.updateTokens()` (DB refreshed)
5. Broker WS reconnects within ~5 seconds; refresh the page

#### Option C — Diagnose the cron-reauth failure
T-113/T-107 logs the exact Kite response on every failure:
```bash
ssh deployer@141.148.192.4 'docker logs ats-backend 2>&1 | grep -iE "cron-reauth|reactive|kite response" | tail -30'
```
Check the most recent `kite response` line for:
- `kite_error_type: "TokenException"` → request_token race (T-117 should catch this; if not, investigate _isRowFreshToday timing)
- `kite_error_type: "InputException"` → checksum mismatch (api_secret out of sync) → see Incident 2
- `kite_error_type: "NetworkException"` → transient Kite outage; wait
- `kite_error_type: "TokenException: token has expired"` → request_token TTL elapsed (daemon stuck)

#### Option D — Inspect broker_accounts row directly
```bash
ssh deployer@141.148.192.4 'docker exec ats-backend node -e "
  const{open}=require(\"./db\");
  const d=open(\"/var/lib/ats/db/ats.db\");
  const r=d._conn.prepare(\"SELECT broker_user_id,issued_at,expires_at,last_test_ok,last_test_error FROM broker_accounts WHERE broker=?\").get(\"zerodha\");
  console.log(JSON.stringify(r,null,2));
"'
```
- `issued_at` < today → last successful reauth was yesterday or earlier
- `last_test_error` carries the most recent failure verbatim (T-107)

---

## Incident 2: Daily auto-reauth shows "exchange_failed: kite_TokenException"

**Symptom:** Brokers screen says "Daily auto-reauth: failed · exchange_failed" but `Live data feed: streaming` (contradictory state).

**Root cause:** OAuth callback handler races the cron's exchange call. Both try to use the same single-use request_token; the callback wins, the cron logs failure. As of T-117/T-118/T-119 this is HANDLED — `runAutoReauth` polls broker_accounts.issued_at and returns `via:'oauth_callback'` when the callback already succeeded. If you still see this:

1. Verify T-117/T-118/T-119 are in the deployed container:
   ```bash
   ssh deployer@141.148.192.4 'docker exec ats-backend grep -c "T99-T117\|T99-T118\|T99-T119" /app/me-broker.js /app/server.js'
   # Expect >= 3
   ```
2. If the codes are missing, the deploy didn't include the fix. Re-deploy.
3. If the codes are there, the race window may have exceeded T-117's 4s timeout. Increase `maxMs` in `_waitForCallbackPath` in `me-broker.js`.

---

## Incident 3: API rotating Kite app credentials (api_secret regenerated)

**Symptom:** Every cron-reauth fails with "Invalid checksum" or "Token is invalid". `broker_accounts.api_key` matches developers.kite.trade but **exchange fails consistently** — not a race, not transient.

**Recovery:**
1. Visit https://developers.kite.trade/apps/ → your app → copy the current api_secret
2. Go to Brokers card → Edit Zerodha → paste new api_secret → Save
3. The save handler re-seals via libsodium and writes to broker_accounts
4. Click **Manual reauth** to mint a fresh access_token with the new secret
5. Tomorrow's 05:45 IST cron will succeed

---

## Incident 4: Scanner cron failed at 15:35 IST

**Symptom:** No new signals on /api/scanner/history after 15:40 IST on a trading day. `/api/scanner` shows lastRun.at older than expected.

**Recovery:**
```bash
# Trigger a manual scan
curl -X POST https://ats.rajasekarselvam.com/api/scanner/run -H 'Content-Type: application/json' -d '{}'

# Watch logs
ssh deployer@141.148.192.4 'docker logs ats-backend --tail 50 2>&1 | grep -i scanner'
```

Common causes:
- Broker WS stalled (see Incident 1) — scanner can't fetch candles
- Surveillance gate (T-99-E2) blocked ALL symbols — check watchlist for ASM/GSM listings
- Results-day blackout (T-125) blocked ALL symbols — earnings week
- Kite rate limit hit — wait 60s and retry

---

## Incident 5: DR restore-test stale (drStale=true)

**Symptom:** /api/health-deep shows `drStale: true`. The monthly DR restore-test (1st of month at 03:30 UTC) didn't run or failed.

**Recovery:**
```bash
ssh deployer@141.148.192.4 'sudo /opt/ats/scripts/dr-restore-test.sh --notify'
# Tails to /var/log/ats/dr-restore-test.log
```

If the script reports a backup-staleness issue:
```bash
ssh deployer@141.148.192.4 'tail -50 /var/log/ats-rclone.log'
# Look for last successful rclone copy of /db/ats.db
```

If rclone failed, check rclone remote auth via `rclone lsd ats-archive:` from the VM.

---

## Incident 6: Container won't start after deploy

**Symptom:** `curl https://ats.rajasekarselvam.com/api/health` returns 502 or times out. GitHub Actions deploy showed success but container is dead.

**Recovery:**
```bash
ssh deployer@141.148.192.4 'docker ps --format "{{.Names}} {{.Status}}" | grep ats'
# If unhealthy or restarting:
ssh deployer@141.148.192.4 'docker logs ats-backend --tail 100'
```

Common boot failures:
- `[broker.rehydrate] failed: ENOENT /etc/ats/master.key` → master.key file permissions wrong
- `Cannot find module ./xxx` → npm install didn't complete in image build
- `EACCES: permission denied, open '/var/lib/ats/...'` → tokens dir ownership wrong (should be ats:ats)

Quick rollback to previous image:
```bash
# Get previous image SHA from GHCR
ssh deployer@141.148.192.4 'docker pull ghcr.io/kumarikrisnan509-eng/ats-backend:PREVIOUS_SHA && docker-compose up -d'
```

---

## Incident 7: Host-side morning-check (08:50 IST) broken

**Symptom:** Auto-login at 08:50 IST fails with "Executable doesn't exist at /home/deployer/.cache/ms-playwright/...".

**Recovery:**
```bash
ssh deployer@141.148.192.4 'cd /opt/ats && sudo -u ubuntu npx playwright install chromium'
```

Note: The in-app cron-reauth at 05:45 IST uses a SEPARATE Playwright daemon (`/opt/ats-auto-login/`) that's independent. Host morning-check is a backup; the in-app cron is the primary.

---

## Incident 8: AI spend cap exceeded (/api/me/ai-keys returns 429)

**Symptom:** AI workflows return 429 with `reason: spend_cap_exceeded`.

**Recovery:**
1. Check current spend: Brokers → AI providers → "Today's spend" widget
2. Either:
   - Wait until midnight IST (cap resets)
   - Raise the cap: Settings → AI providers → "Daily spend cap (₹)" → save

---

## Where to look for clues

| What you need | Where to find it |
|---|---|
| HTTP error correlation | `x-request-id` header on every response (T-78) → `errors_log` table |
| Broker connection state | `/api/health-deep` checks.broker* fields |
| AI call history | `/api/admin/ai-trace` (admin only, T-122) — last 50 ai_calls with status |
| Recent audit events | `/api/audit?limit=100` — all server-side events |
| Cron-reauth history | `cron_reauth_history` table — each row has reason + kite details (T-107/T-113) |
| Per-route latency | `/api/admin/observability` (admin only, T-78) — P50/P99 by route |
| Container logs | `docker logs ats-backend --tail 200` |
| Audit log file | `/var/log/ats/audit.log` (rotated daily, archived to GDrive) |

## Self-healing systems already in place

The following autonomous recoveries fire automatically (no operator action needed):

| Failure | Self-heal mechanism |
|---|---|
| Broker WS 403 stall (T-58 detector) | T-115 reactive trigger → cron.runNow() within seconds |
| Daily token expiry | T-116 multi-window cron (05:45/09:00/13:00 IST) |
| Single cron-reauth failure | T-114 retry chain (+15min/+30min/+60min/+2h/+4h) |
| OAuth callback / cron race | T-117 polls DB; T-118/T-119 sync callback path to DB |
| Container restart | T-106b boot rehydrate reads DB-first (T-106 wired global broker resume) |
| Stale per-user broker tokens | Cron-reauth handles per-user rotation via T-106 |
| Rate-limited reactive trigger | T-115 enforces 1-per-15min / 3-per-24h to avoid spam |

When self-healing fails, T-114 fires a Telegram alert: "ATS auto-reauth retry chain exhausted".

---

## Contact & escalation

| Tier | Action |
|---|---|
| 1 | Operator (rajasekarjavaee@gmail.com) — first 2 hours |
| 2 | Self-resolve via this runbook |
| 3 | Cancel orders via Kite app + engage kill switch in ATS |
| 4 | Disable auto-reauth temporarily by editing broker_accounts.auto_reauth_enabled=0 |

Telegram bot delivers automated alerts to the operator (configured in Settings → Notifications).

---

## Change log

- 2026-05-18 — initial runbook (T-128, v11-I4). Synthesized from T-106 through T-127 operational learnings.

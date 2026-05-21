# Phase 4 Options Trial Run — Operator Runbook

**Created:** 2026-05-21 (post-close)
**Targets:** First market-hours run with `OPTION_CHAIN_FETCH_ENABLED=true`
**Risk profile:** Read-only against Kite + write to two new DB tables. No order
path is touched. KILL_SWITCH stays on, LIVE_TRADING stays off.

---

## Pre-flight (do once, after close, while you are calm)

1. **Verify the deploy is current.** From your laptop:
   ```
   curl -s https://ats.rajasekarselvam.com/api/health | jq .uptimeSec
   ```
   Should match the last commit on `main` minus boot time. If older than the
   most recent push, check Actions for a failed deploy run.

2. **Verify the new endpoints respond.** Should both be 200 OK (with empty
   data until the fetcher runs):
   ```
   curl -s https://ats.rajasekarselvam.com/api/option-chain/NIFTY
   curl -s https://ats.rajasekarselvam.com/api/option-chain/NIFTY/expiries
   ```

3. **Confirm safety envelope.** All three must show:
   ```
   curl -s https://ats.rajasekarselvam.com/api/health | jq '{killSwitch, liveTrading}'
   # {"killSwitch": true, "liveTrading": false}
   ```

---

## Day-of (do this after 09:15 IST tomorrow)

### Step 1 — SSH to VM and add the underlying list

```powershell
$KEY = "C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key"
ssh -i $KEY ubuntu@ats.rajasekarselvam.com
```

On the VM:

```bash
sudo nano /etc/ats/backend.env
```

Add these lines (preserve existing entries):

```
# T-290e: Phase 4 options chain fetcher — start with NIFTY only
OPTION_CHAIN_UNDERLYINGS=NIFTY
OPTION_CHAIN_EXPIRY=
OPTION_CHAIN_INTERVAL_MS=300000

# Do NOT enable this on first boot. We want to confirm config loaded first.
OPTION_CHAIN_FETCH_ENABLED=false

# T-298a: options scanner — STAYS OFF until fetcher is proven
OPTIONS_AUTORUN_ENABLED=false
OPTIONS_SCANNER_UNDERLYINGS=NIFTY
```

Save (Ctrl+O, Enter, Ctrl+X).

### Step 2 — Restart backend WITHOUT enabling fetcher yet

```bash
sudo docker compose -f /opt/ats/docker-compose.yml restart backend
sleep 8
sudo docker logs --tail 30 ats-backend 2>&1 | grep -E "option-chain|options-scanner"
```

You should see:

```
[server] option-chain fetcher instantiated (idle -- env gate off or no underlyings)
[server] options scanner instantiated (SHADOW only, gated by OPTIONS_AUTORUN_ENABLED)
```

Both instantiated but idle. Good. If you see "armed" instead, you set the gate to `true` somewhere -- go back and verify.

### Step 3 — Flip fetcher ON

```bash
sudo sed -i "s/^OPTION_CHAIN_FETCH_ENABLED=false/OPTION_CHAIN_FETCH_ENABLED=true/" /etc/ats/backend.env
grep OPTION_CHAIN /etc/ats/backend.env
sudo docker compose -f /opt/ats/docker-compose.yml restart backend
```

After ~10 seconds:

```bash
sudo docker logs --tail 40 ats-backend 2>&1 | grep -E "option-chain|fetcher"
```

Expected:

```
[server] option-chain fetcher armed (1 underlyings @ 300000ms)
[option-chain-fetcher] refresh NIFTY/2026-05-29: 140/140 persisted, 0 errors
```

(The exact strike count varies; 140 is a typical NIFTY weekly chain CE+PE.)

### Step 4 — Verify on the public API

From your laptop:

```
curl -s "https://ats.rajasekarselvam.com/api/option-chain/NIFTY/expiries"
```

Should return a list of expiries with row counts. If it does -- the fetcher is working end-to-end. 

```
curl -s "https://ats.rajasekarselvam.com/api/option-chain/NIFTY" | jq '.spot, (.strikes | length)'
```

Confirms spot (current NIFTY price) and number of grouped strikes.

### Step 5 — Watch one refresh cycle (~5 min)

Wait 5+ minutes. Then re-check:

```
curl -s "https://ats.rajasekarselvam.com/api/option-chain/NIFTY/expiries" | jq '.expiries[0].latest'
```

The `latest` timestamp should be more recent than your first read. That proves the cron is ticking.

---

## Step 6 — (Optional, NEXT step) Enable the scanner

**Only do this after the fetcher has been running cleanly for at least 1 full
trading day.** The scanner reads from `option_quotes`; if the chain data is
stale or empty the scanner just no-ops, but the integration is more meaningful
once you have a few refreshes in the table.

```bash
sudo sed -i "s/^OPTIONS_AUTORUN_ENABLED=false/OPTIONS_AUTORUN_ENABLED=true/" /etc/ats/backend.env
sudo docker compose -f /opt/ats/docker-compose.yml restart backend
```

The scanner runs *after* the existing autorun 8-gate chain on each tick.
SHADOW only -- writes to `option_opportunities` table, NO order placement.

View opportunities in the UI: nav -> System -> Options ops (new screen).

---

## Rollback (any of these will silently disable Phase 4)

```bash
sudo sed -i "s/^OPTION_CHAIN_FETCH_ENABLED=true/OPTION_CHAIN_FETCH_ENABLED=false/" /etc/ats/backend.env
sudo sed -i "s/^OPTIONS_AUTORUN_ENABLED=true/OPTIONS_AUTORUN_ENABLED=false/" /etc/ats/backend.env
sudo docker compose -f /opt/ats/docker-compose.yml restart backend
```

Both modules check env on each call. Setting them back to `false` makes the
fetcher cron a no-op (it still ticks, refuses to do anything) and the scanner
short-circuit. No data is destroyed; `option_quotes` and `option_opportunities`
tables persist with last known content.

---

## What to watch for during the trial

| Signal | Meaning | Action |
|---|---|---|
| fetcher log says "refresh ... 0/N persisted, N errors" | Kite call failing | Check `sudo docker logs ats-backend \| tail -100` for the actual error. Usually `not authenticated` (Kite token expired) -- the daily auto-reauth at 07:00 IST handles this. |
| `option_quotes` row count not growing | UPSERT working (correct) -- count stays equal to chain size | This is normal. Only the snapshot_at column updates. |
| Scanner logs "no opportunities" | regime returned unknown OR selector decided nothing scored | Normal in volatile/crisis regimes. Check `/api/me/regime` to see current detection. |
| Greeks panel on Risk Cockpit stays empty | No matching positions in option_quotes | Will appear automatically when you have at least one open option position whose tradingsymbol appears in option_quotes. |
| Memory or CPU spike on the VM | Refresh interval too tight OR getQuotes batch too large | Increase `OPTION_CHAIN_INTERVAL_MS=600000` (10 min). |

---

## Decision matrix for adding BANKNIFTY

Only after NIFTY has been clean for 2+ trading days:

```bash
sudo sed -i "s/^OPTION_CHAIN_UNDERLYINGS=NIFTY$/OPTION_CHAIN_UNDERLYINGS=NIFTY,BANKNIFTY/" /etc/ats/backend.env
sudo sed -i "s/^OPTIONS_SCANNER_UNDERLYINGS=NIFTY$/OPTIONS_SCANNER_UNDERLYINGS=NIFTY,BANKNIFTY/" /etc/ats/backend.env
sudo docker compose -f /opt/ats/docker-compose.yml restart backend
```

BANKNIFTY chain is ~50% larger than NIFTY -- the 300s refresh will take ~25s
during the getQuotes phase. If you see Kite rate-limit warnings, bump
`OPTION_CHAIN_INTERVAL_MS=600000`.

---

## Reference: env vars affecting Phase 4

| Var | Default | Purpose |
|---|---|---|
| `OPTION_CHAIN_FETCH_ENABLED` | (unset = false) | Master gate for fetcher cron |
| `OPTION_CHAIN_UNDERLYINGS` | (empty) | Comma list e.g. `NIFTY` |
| `OPTION_CHAIN_EXPIRY` | (empty = nearest) | Specific YYYY-MM-DD to lock to |
| `OPTION_CHAIN_INTERVAL_MS` | 300000 (5min) | Refresh period; floor 60000 |
| `OPTIONS_AUTORUN_ENABLED` | (unset = false) | Master gate for scanner shadow writes |
| `OPTIONS_SCANNER_UNDERLYINGS` | (empty) | Comma list scanner iterates |
| `ATS_OPS_KEY` | (set on VM) | Manual `POST /api/option-chain/refresh` auth |

All gates are read at runtime, not at boot -- restart is required only when
you ADD or REMOVE keys, not when you toggle their values within an already-
read variable. To be safe, restart after every change.

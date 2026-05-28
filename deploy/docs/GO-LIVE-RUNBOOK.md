# ATS Go-Live Runbook (Phase 0 + Phase 6)

Companion to `PRODUCTION-READINESS-AUDIT.md`. This is the operator handbook for moving from "paper sandbox" to "graduated live trading" once all 6 Phases are shipped.

---

## Phase 0 — Make paper actually trade (DO THIS FIRST)

**Problem:** As of T-505 the autorun has produced zero closed trades in its history. Single config (`rsi_mean_revert` on RELIANCE with entryRsi=30 / exitRsi=65) has not been crossing thresholds. Until paper trades flow, the entire safety+promotion stack is dry-run.

**Recommended Phase 0 settings** (one-time POST to `/api/autorun/config` while logged in to the dashboard):

```json
{
  "enabled": true,
  "strategy": "supertrend",
  "symbol":   "RELIANCE",
  "params":   { "period": 10, "multiplier": 3 },
  "qty":      5,
  "interval": "15minute",
  "intervalMinutes": 15,
  "candleLookbackDays": 60,

  "stopLossPct":     1.0,
  "targetPct":       2.0,
  "trailingStopPct": 0.8
}
```

Why these choices:
- `supertrend` fires more often than RSI mean-reversion and is well-suited for intraday RELIANCE.
- `15minute` candles give 25 bars/day — enough for the strategy to see signal flips.
- Phase 1 (T-508) just shipped: setting `stopLossPct` + `targetPct` enables BRACKET orders in paper. Without these, autorun fires naked.
- 1% SL / 2% TP / 0.8% TSL = roughly 1:2 risk/reward with a tighter trail.

**Verification gate before moving on:**
- Wait 1–2 trading days
- `SELECT COUNT(*) FROM paper_closed_trades` returns ≥ 5
- `/api/autorun/history` shows entries with `result: 'placed'` (not all `no_signal`)

---

## Phase 6 — Graduated live rollout (DO THIS LAST)

**Pre-flight checklist** (all four must be true before flipping anything):

1. Phase 0 verification gate passed (paper trades flowing for ≥ 5 days)
2. `/api/health.degraded` shows all 6 counters = 0 over the validation window
3. `/api/health.holidays.source !== 'static_fallback'` (operator has run `POST /api/admin/market/holidays/manual` with the current NSE calendar)
4. `eod-reconcile` (T-510, runs at 15:45 IST) has shown 5 consecutive days of zero broker-vs-local mismatches

**Stage 1 — One strategy, capped, observer mode (Day 1–5)**

```sql
-- Promote one strategy via /api/me/risk-config:
liveEnabledStrategies = ['supertrend']
strategyCaps = { 'supertrend': 5000 }    -- ₹5,000 per-strategy notional cap
tradingMode = 'micro_live'
```

Then flip envs in `/etc/ats/backend.env`:

```
KILL_SWITCH=false
LIVE_TRADING=true
ATS_AUTORUN_2FA_BYPASS=true            # T-509 explicit opt-in for unattended autorun
ATS_DISCONNECT_AUTOSQUARE_ENABLED=true # T-504 watchdog armed (5-min trigger)
```

Restart the container. Check the boot log shows:
```
[server] disconnect-watchdog armed (ENABLED)
[server] promote-scheduler armed (23:30 IST daily)
[server] eod-reconcile armed (15:45 IST daily)
[server] morning-digest armed (08:30 IST weekdays)
[server] pre-trade pipeline armed (3 legacy + 2 new gates)
```

**Watch for 5 trading days.** Any of these → revert to paper:
- `degraded` counters > 0
- EOD reconcile shows any mismatch
- Watchdog fires any auto-squareoff
- More than 1 rejected order per day from the broker

**Stage 2 — Two strategies, higher cap (Day 6–10)**
Add `rsi_mean_revert` to `liveEnabledStrategies`. Raise cap to ₹10,000 per strategy. Watch the same metrics for 5 more days.

**Stage 3 — Full graduated rollout (Day 11+)**
Add strategies as they pass the nightly promote-scheduler's 7 gates (T-499/T-500). Raise caps. Keep `disconnect-watchdog` armed and the daily-loss circuit conservative (₹2,000 initial).

---

## Emergency operator runbook

| Situation | Action |
|---|---|
| You see anything weird | Hit the Square-Off button in the dashboard header (1.5s hold → preview modal → confirm). Engages soft-kill + flattens every open position. |
| Square-Off button doesn't respond | `curl -X POST https://ats.rajasekarselvam.com/api/admin/square-off-all -H 'Content-Type: application/json' -d '{"confirm":"SQUARE-OFF-ALL"}' --cookie-jar /tmp/c` (after authenticating via `/api/me/login`) |
| Both above fail | SSH to VM: `sudo docker exec ats-backend node -e "require('./services/soft-kill').set({reason:'manual',by:'ops'})"` then open Kite web UI and flatten manually. |
| Promote-scheduler promoted a bad strategy | Edit `risk_config.live_enabled_strategies_json` directly: `sudo sqlite3 /var/lib/ats/tokens/ats.db "UPDATE user_risk_config SET live_enabled_strategies_json='[]' WHERE user_id=N"`. Next autorun tick reverts to paper. |
| Broker disconnect lasting > 1 hour | Watchdog will have auto-squared (if `ATS_DISCONNECT_AUTOSQUARE_ENABLED=true`). Verify with `/api/health`. If not enabled, manually run square-off-all. |

---

## What's NOT in this runbook (yet)

These are the deferred items from the Phase audit. **Do not flip live until each is either shipped or you've accepted the risk:**

- **Phase 2 (multi-config engine)** — today's runner is single-strategy/single-symbol. Stage 2+ requires manually rotating configs via `/api/autorun/config`. Real multi-config parallelism ships in T-511.
- **Phase 4 (order status polling + retry)** — order rejections silently retry next tick with no escalation. Partial fills not detected. Ships in T-512.
- **Live SL/TP via GTT** — Phase 1 (T-508) ships BRACKET for paper only. Live route still fires naked MARKET with a `live_protection_skipped` audit warning. Ships in T-510-live.

---

## Health-check cheat sheet

```bash
# Drift check — is local on same SHA as origin?
curl https://ats.rajasekarselvam.com/api/version

# Full health (every gate counter, holidays cache, broker, audit)
curl https://ats.rajasekarselvam.com/api/health | jq

# What would the EOD reconcile say right now?
curl -X POST https://ats.rajasekarselvam.com/api/admin/reconcile/run --cookie /tmp/c | jq

# What would the morning digest look like?
sudo docker exec ats-backend node -e "(async () => {
  const ms = require('./services/morning-digest').createMorningDigest({...});
  console.log(await ms.runNow());
})()"

# Last 25 autorun ticks
sudo docker exec ats-backend cat /var/lib/ats/tokens/_autorun.json | jq '.history[-25:]'

# Is the kill switch held?
curl https://ats.rajasekarselvam.com/api/admin/soft-kill --cookie /tmp/c | jq
```

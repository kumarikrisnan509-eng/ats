# Production-Readiness Audit — 2026-05-28

Source: deep audit run during T-496 work session. This document captures the **P1 and P2** findings; P0s are being shipped in the same session and tracked under T-496..T-501.

Use this as the single source of truth for what's still left before flipping `KILL_SWITCH=false` + `LIVE_TRADING=true` would be safe for unattended live trading.

---

## P0 (shipped in T-496..T-501)

| # | Issue | Status |
|---|---|---|
| T-496 | No holiday + market-hours gate on order placement (autorun, pre-trade, sip-runner) | shipped |
| T-497 | Trading modes (Intraday/Swing/Options/Futures) are frontend-only; backend never reads `activeModes` | pending |
| T-498 | No panic-square-off endpoint — `KILL_SWITCH` only blocks new orders, can't flatten live positions | shipped (backend) |
| T-499 | No paper→live auto-promotion despite UI claiming it; promotion criteria diverge UI vs backend | pending |
| T-500 | (rolled into T-499) Promotion criteria mismatch — UI shows Sharpe≥1.2; backend doesn't check Sharpe | pending |
| T-501 | No per-strategy paper/live toggle — flipping `tradingMode` exposes all 22 strategies at once | pending |
| ~T-N/A~ | ~Autorun in-memory dedupe + daily-cap lost on restart~ | **false finding** — T-359 already persists both to `_autorun.json` |

---

## P1 backlog (should fix soon — silent failures, partial enforcement)

### Silent-drop paths

1. **F&O lot-size check is skipped on non-Zerodha brokers** (`routes/orders.js:455-467`). Only Zerodha exposes `broker.symbolMeta()`; Mock/Upstox/Dhan/AngelOne fall through with an `order.lotSizeCheck.skipped` audit event but no notify. Fix: emit a Telegram warning on every skip, OR make non-Zerodha brokers refuse F&O orders entirely until they implement `symbolMeta`.
2. **Autorun regime check is "permissive on failure"** (`autorun.js:300-305`). A persistent regime-detector outage defeats the regime gate without operator awareness — `run.regimeError` is stored but no notify fires. Same pattern for the economics check (`autorun.js:353-356`).
3. **Autorun catches all throws inside runOnce** (`autorun.js:477-479`). Caught errors land in `run.error` only; Telegram fires only on the `.placed` success path. Silent failures are invisible unless the operator polls `/api/autorun/history`. Fix: notify on `run.error != null` at least once per 60 s burst.
4. **Pre-trade aggregator failures are permissive** (`pre-trade.js:128-131, 162-164`). Leverage and sector caps become no-ops if `portfolio-aggregates` throws. Same blast pattern as #2. Fix: rate-limited Telegram; consider auto-tripping soft-kill above a threshold.
5. **Scanner timer is `unref()`'d** (`scanner.js:334`). A graceful process exit during a long scan loses the run with no resume hook on restart. Fix: write `inflight=true` to disk before scan begins, replay on boot.
6. **Options scanner shadow errors swallowed twice** (`autorun.js:492-494` + `:517-519`). Two audit-only catches; a stuck options scanner is undetectable without operator polling.
7. **SIP "no_price" skip drops the month silently** (`sip-runner.js:133-135`). If `broker.getLastTicks()` returns nothing at the scheduled minute, the SIP for that symbol gets `skipped: no_price` and the next tick re-evaluates with the same condition. No retry escalation, no operator notification of a missed SIP day.

### Single-bucket / shared-state issues

8. **`MAX_ORDERS_PER_MIN` is a global bucket** (`server.js:137` comment admits "per-user (today: global)"). One runaway strategy can starve all users. Fix: keyed bucket by `userId`.
9. **Static holiday fallback is 4 dates and 2026-only** (`market-meta.js:10-17`). If `kc.getHolidays()` 404s on a non-cached install or after 2026-12-25, holiday gates silently degrade to the fallback list. Fix: extend to a multi-year curated NSE list AND expose `holidays.cacheAgeDays` on `/api/health` so a stale cache surfaces in the dashboard.
10. **No `holidaysCacheAgeDays` on `/api/health`**. The new T-496 gate is only as good as the cache; right now the cache age is invisible to the operator.

### Live-broker resilience

11. **Mid-day broker disconnect leaves open positions exposed**. The Zerodha ticker has bounded reconnect (`brokers/zerodha-broker.js:257-294`) and after 3× HTTP 403 it pauses + fires Telegram (`services/tick-fanout.js:107`). No automatic flatten of open positions; they sit at last-tick until reconnect or manual intervention. Fix: optional auto-square on N-minutes of disconnect during market hours.
12. **No per-strategy live/paper toggle today** (covered in T-501).
13. **No "strategy budget" cap**. Pre-trade enforces aggregate exposure (₹20L) but not per-strategy. A misbehaving strategy can consume the whole book.

---

## P2 backlog (nice-to-haves / cosmetic / observability)

14. **Dashboard "22 active" is the registry size, not enabled count** (`schema.sql:259` default has 3 entries). Both the dashboard counter and the Strategies page agree because they read the same `/api/strategies` (registry), so the bug is "wrong-but-consistent". Fix: change counter to read `risk_config.active_strategies_json` length per user.
15. **No `/api/version` field for `holidays.fetchedAt`** (related to #10). Tie into the existing `/api/version` endpoint shipped under T-494.
16. **No squared-off-all UI button**. T-498 ships the backend; the frontend button next to Kill is still pending. Wire `POST /api/admin/square-off-all` with the `confirm: 'SQUARE-OFF-ALL'` body.
17. **`tradesToday` resets at IST midnight** but the rollover code runs only inside `autorun.runOnce` (`autorun.js:312`). If autorun is paused at midnight (weekend), the first run on Monday correctly rolls; if autorun has been running every 5 min through Sunday, that's harmless. Edge case if someone toggles `enabled=true` between midnight and the next 5-min tick on a holiday morning. Low risk; flag for awareness.
18. **`STATIC_FALLBACK_HOLIDAYS` doesn't have a unit test** (`market-meta.test.js:7` documents the intent but never verifies). Fix: add a test that calls `isHolidayOrWeekend('2026-01-26')` and asserts `closed=true, reason='holiday'`.
19. **Single VM, single process; no documented failover**. Acceptable for a single-operator system but should be acknowledged.
20. **WORM audit log isn't rotated** (file at `deploy/backend/audit.log`). Will eventually need a rotation policy or it grows unbounded.

---

## Conclusion

After T-496..T-501 ship, the system goes from **"not safe to flip the live flag"** to **"safe with operator-in-the-loop monitoring"**. Full unattended-overnight-trading readiness would also need P1 #8, #9, #10, #11 at minimum.

Re-audit recommended after any of: T-499 lands (changes the trust model — first time the system makes live-vs-paper decisions on its own), broker change (e.g., adding Upstox), or any change to `risk_config.active_strategies_json` schema.

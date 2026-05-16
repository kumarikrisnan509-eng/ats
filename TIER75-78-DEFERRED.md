# Tiers 75-78 — Deferred to next session, with scope clarity

This file documents what's left after the autonomous Sprint E run (Tiers 71-74 ✓).

## Tier 75 — Per-user WebSocket subscription multiplexing
**Why it's deferred:** The current `/ws` endpoint broadcasts every tick to every connected client. To scope ticks per-user we need:
1. WebSocket auth on connect — read the `ats_sid` cookie from the upgrade headers, look up `user_id` in DB
2. Per-WS-client subscription set — load the user's `watchlist` from DB on connect
3. Outbound filter — only forward ticks for symbols in that user's set
4. Mutation hooks — when user adds/removes a watchlist symbol, push subscribe/unsubscribe to the upstream Kite ticker (which has a 3000-symbol limit per connection)

**Realistic time:** 2 days (1 day backend, 1 day testing under multi-user concurrent load).

## Tier 76 — Daily auto-rotate via TOTP for per-user Kite tokens
**Why it's deferred:** The existing `zerodha-auto-login.js` runs on the VM **host** (not in the container) using Playwright. Per-user version needs:
1. New internal route `POST /api/admin/internal/bulk-rotate` that returns a list of `(user_id, sealed_api_key, sealed_api_secret, sealed_totp_seed, sealed_password)` for users with TOTP seeds
2. Host-side script that calls that route, loops over users, runs Playwright headless Kite login for each, captures request_token, calls `POST /api/admin/internal/seal-token` to persist the new access_token
3. systemd timer at 5:45 AM IST weekdays
4. Telegram notification per user on success/failure

**Realistic time:** 1.5 days (mostly testing the headless flow per user since each Kite session has IP-based rate limits).

## Tier 77 — Rebuild 7 screens (Strategies, Live Trading, Signals, Modes, Compliance, Money, Portfolio)
**Why it's deferred:** Each screen needs:
1. Audit which UI elements are mock (in `__mock_items` arrays or hardcoded strings)
2. Identify the per-user backend route they SHOULD pull from (often doesn't exist yet — needs new aggregator endpoint)
3. Build the new endpoint
4. Wire the screen
5. Empty-state / no-broker-connected fallbacks
6. Visual polish

**Realistic time:** ~2 weeks (3 days per screen × 7, with overlap on shared components).

## Tier 78 — End-to-end Playwright happy-path spec
**Why partial:** A spec file CAN be written in-session. **Running** it requires Playwright on the host with browser binaries (Chromium ~150MB) and the live VM reachable. The repo has `test-e2e/playwright.config.js` already.

**Realistic time:** 1 day to write the spec + 0.5 day to debug flakiness against live infra.

---

## What was actually shipped autonomously this session (Tiers 71-74)

| Tier | What | Live? |
|---|---|---|
| 71 | Holidays from Kite API + `/api/market/holidays` cache + frontend reads cache | ✓ |
| 72 | `POST /api/me/paper/order` — fills at live LTP from ticker + slippage bps | ✓ |
| 73 | Converted `/api/preflight` + `/api/orders/place` to per-user `pickBroker(req)` | ✓ |
| 74 | Removed hardcoded ₹47,88,920 / ₹48,41,760 / ₹47,62,400 / ₹48,27,340 / ₹48.3L from Dashboard equity card and donut total | ✓ |

## Recommended next session sequence

1. Tier 75 (per-user WS) — biggest user-visible improvement
2. Tier 78 (Playwright spec) — locks in the happy path so future tiers don't regress
3. Tier 76 (TOTP rotation) — quality of life for power users
4. Tier 77 (7 screens) — bulk rebuild, in 2-screen chunks per session

Total: roughly 4 weeks of focused work to "everything live, fully production-grade."

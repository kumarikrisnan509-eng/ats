# TIERS.md — historical Tier nomenclature

**Status:** Retired going forward. Use `T-NNN` ticket numbers (see `audit-T355/`, commit messages).

## What is a "Tier"?

Early development used the convention `Tier N` to label batched feature drops — each Tier number corresponds to one batch of related changes that shipped together. The convention worked while the count stayed small but accumulated organizational debt: numbers had no global ordering rule, sub-letters (Tier 69a / 69b / 69c) were ambiguous, and grepping for `Tier 24` to find related code returned both intentional references AND accidental string matches.

The architecture audit (T-355) recommended retiring the convention and using `T-NNN` ticket numbers going forward. Every commit since T-300+ uses `T-NNN` exclusively. This file exists so anyone reading older code comments can map a `Tier N` reference back to its feature batch.

## Migration policy

- **New code:** never add `Tier N` to comments. Use `T-NNN`.
- **Old code:** leave existing `Tier N` references in place. Rewriting them all would generate noise without value.
- **When touching old code:** if a comment mentions `Tier N` and you understand what it does, you can optionally append `(see T-355 for retirement)` — but don't go out of your way.

## Catalog (auto-extracted from code comments)

| Tier | Origin file | One-line description (paraphrased from first reference) |
|---|---|---|
| 6 | `screen-ai-review.jsx` | live Claude integration helpers |
| 7 | `screen-signals.jsx` | Live Scanner from /api/scanner -- real RSI/EMA20 hits on watchlist |
| 8 | `screen-dashboard.jsx` | live dashboard metrics |
| 11 | `server.js` | even with KILL_SWITCH=false, live trading also requires LIVE_TRADING=true |
| 12 | `shell.jsx` | name + email now pulled from /api/profile (live Kite session) |
| 13 | `shell.jsx` | replace hardcoded badge text for `strategies` and `brokers` with live values |
| 14 | `r9-additions.jsx` | replaces fake 6-row login history ============ |
| 15 | `server.js` | pre-trade risk-gate circuits. All values default to safe levels |
| 16 | `shell.jsx` | Notifications dropdown -- now feeds from /api/scanner/history (last 24h) |
| 17 | `screen-risk.jsx` | live risk-cap usage from /api/system/info + /api/paper + /api/summary |
| 18 | `server.js` | long-term wealth engine (SIPs, buckets, SWP simulator, goal inflation) |
| 19 | `screen-stp-swp.jsx` | live SIP manager + SWP simulator backed by /api/sip + /api/swp/simulate |
| 20 | `screen-money.jsx` | bucket strategy (emergency / short-term / long-term) |
| 21 | `server.js` | Wealth reference catalogs (bonds / REITs / smallcases / traders) ---------- |
| 22 | `screen-compliance.jsx` | live SEBI-algo-framework readiness from /api/system/info + /api/audit |
| 23 | `server.js` | rebalance suggestions. Auto-derives buckets + holdings + paper equity + cash if not in body |
| 24 | `screen-money.jsx` | rebalance suggestions |
| 25 | `screen-money.jsx` | Portfolio optimiser (MPT) |
| 26 | `paper.js` | BRACKET entry fills like MARKET if price is null, otherwise like LIMIT |
| 27 | `server.js` | replay engine (uses backtest's computeSignal) and email alerts |
| 28 | `server.js` | optional { tier: '10L' \| '25L' \| '50L' } or { startingCash: <int> |
| 31 | `server.js` | factor-tilt portfolio construction (momentum / value / quality / low-vol / size) |
| 32 | `server.js` | mirror into the WORM (tamper-evident) log if initialized |
| 33 | `screen-paper.jsx` | Bracket order builder wired to /api/orders/dry-run (Tier 26 backend) |
| 34 | `server.js` | F&O SPAN-style margin simulator (pre-trade estimator) ---------- |
| 35 | `server.js` | static IP allowlist (SEBI access-control compliance) ---------- |
| 37 | `server.js` | echo the IP the server sees for this client, so users can paste |
| 38 | `server.js` | confirm a 2FA-pending order. Replays the held payload through |
| 39 | `screen-portfolio.jsx` | FactorTiltPanel -- wires POST /api/portfolio/factor-tilt |
| 41 | `server.js` | reject a pending 2FA token. Useful when the user spots a |
| 42 | `screen-compliance.jsx` | WormAuditCard -- visual hash-chain timeline view |
| 43 | `screen-strategies.jsx` | AutorunPanel -- frontend for the Tier 3 auto-runner |
| 46 | `server.js` | parse uploaded CAS (Consolidated Account Statement) PDF text |
| 47 | `server.js` | daily/weekly digest emails (uses Tier 27 EmailAlerts under the hood) |
| 49 | `db.js` | SQLite (better-sqlite3) connection + WAL mode + migrations |
| 50 | `server.js` | attach req.user to every request if a valid session cookie is present |
| 53 | `server.js` | per-user data routes (require auth) ---------- |
| 54 | `migrate-from-json.js` | one-time CLI to import existing JSON-file |
| 55 | `mock-data.jsx` | default flipped from true -> false. In production (real users with |
| 56 | `screen-onboarding.jsx` | Onboarding wizard. 4 steps: |
| 57 | `screen-brokers.jsx` | per-user broker credentials. Each user can connect their own Zerodha (or other broker) |
| 58 | `broker-banner.jsx` | top-of-page banner shown when the user is authenticated but has not yet |
| 59 | `app.jsx` | also expose user globally + broker connection status so screens |
| 60 | `screen-dashboard.jsx` | per-user summary aggregator -- single endpoint replaces 4 hardcoded fallbacks |
| 61 | `app.jsx` | anonymous visitors landing on '/' (or 'dashboard' / no-hash) get the |
| 62 | `server.js` | If state= is present, this is a per-user OAuth callback. Decode the state |
| 63 | `server.js` | helper to pick user's broker if authenticated+connected, else fall back to global |
| 64 | `server.js` | Test Connection endpoint ---------- |
| 65 | `live-ticks.jsx` | ONLY update ltp on tick. Never touch prev -- it's the prior day's close |
| 66 | `screen-onboarding.jsx` | paper-trading initial capital (the user picks this; was hardcoded INR 10L before) |
| 67 | `screen-auth.jsx` | Auth screens redesigned with two-panel layout, password strength meter |
| 69 | `screen-ai-advisor.jsx` | 70: Aladdin-style insights panel |
| 69a | `server.js` | per-user portfolio risk metrics derived from pnl_daily snapshots |
| 69b | `server.js` | per-user factor exposure (momentum / volatility / drawdown / concentration) |
| 69c | `ai-advisor.js` | BYOK (Bring Your Own Key) LLM portfolio advisor |
| 70 | `server.js` | deeper health check (db, vault, broker resolver, market hours) |
| 71 | `market-data.jsx` | holidays now come from /api/market/holidays (cached from Kite). The static |
| 72 | `server.js` | paper-trade order placement using live LTP from the global ticker |
| 79 | `db.js` | add per-test bookkeeping columns to broker_accounts (idempotent, ignored if exist) |
| 80 | `me-broker.js` | PUT /api/me/broker/:id/auto-reauth-toggle -- enable/disable daily cron for this row |
| 81 | `me-broker.js` | v1 API surface — RESTful, versioned, plural nouns, /actions/ for RPC verbs |
| 82 | `server.js` | GET /api/v1/me/orders/by-mode -- per-user counts grouped by product/mode ---------- |
| 84 | `db.js` | per-user display preferences (theme, density, currency, etc.) |
| 85 | `screen-settings.jsx` | Settings page polish — sticky side-nav, 2-col layout, sticky save bar |
| 86 | `ai-keys-routes.js` | POST /api/me/ai-keys/test {provider, apiKey?} -- send a minimal request to verify the key works |


**Note:** descriptions auto-extracted by scanning the first `Tier N: ...` or `Tier N -- ...` comment in each file. For the authoritative scope of any tier, grep the codebase: `grep -rn "Tier 86" deploy/ src/`. Some tiers also have implementation docs under `M*.md` or `HANDOFF.md` files in the repo root.

**Coverage:** 65 unique Tier numbers found across `deploy/backend/*.js` and `src/*.jsx`. Some tiers (e.g. anything before Tier 3) predate written documentation and exist only in commit history.

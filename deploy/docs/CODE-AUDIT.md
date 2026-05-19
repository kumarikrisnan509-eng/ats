# ATS Comprehensive Code Audit

**Last updated:** 2026-05-19 (T-194, after T-188..T-193 ship cycle)
**Reference HEAD:** `cdaca7f` (T-192) — production deployed and verified green via T-193 E2E sweep
**Audience:** ATS operator (rajasekarjavaee@gmail.com / Kite ID ARS209), reviewers
**Production endpoint:** https://ats.rajasekarselvam.com
**Scope:** every layer — backend code, frontend code, security, tests, deploy/ops, technical debt. Six parallel agents produced sections A–F. This document supersedes nothing; it adds the cross-layer view that SCREENS-AUDIT.md (frontend per-screen) and SECRETS-AUDIT.md (credential sourcing) do not.

---

## Executive summary — read this first

The system is **mid-stage with strong fundamentals and three specific live-money risks that should be fixed before any new feature ships**. Detailed findings live in §§A–F; the table below distills what is most actionable.

### Headline finding: a security-audit contradiction worth investigating

Section C (security review) was unable to find any Origin/CSRF middleware in `deploy/backend/server.js` — `grep cross_origin / verifyOrigin / sameOrigin` returns zero hits in `deploy/backend/`. Yet `SECRETS-AUDIT.md` §4 reports live probes 6a/7 returning `403 cross_origin_rejected` against production, and the T-193 E2E sweep this session reproduced those exact 403s anonymously. This means **one of three things is true**:

1. The middleware lives in a path the audit didn't grep (possibly in nginx config + a different name in code), OR
2. The 403 actually comes from a different rejection (rate limit? kill switch? missing-cookie 401 misattributed?) and SECRETS-AUDIT mislabeled it, OR
3. There is a divergence between deployed code and the working tree at `cdaca7f`.

**Action: confirm the rejection source before trusting the CSRF posture.** Likely a 1-hour investigation — grep more broadly, add an explicit `audit('csrf.reject', ...)` to the middleware if it exists, or fix the audit.

### Postscript — stale-tree correction (T-194a, 2026-05-19)

**Two of the original P0 findings + several roadmap items were FALSE ALARMS** because the audit was generated against a stale local working tree at HEAD `34d63da` (T-175), missing the 18 commits T-176..T-187 that already shipped many fixes. Specifically:

- **§C.2 CSRF middleware ("missing") — RESOLVED.** The Origin/Referer middleware DOES exist in committed code at `server.js:1070-1111` and produces the `403 cross_origin_rejected` response observed in production. It was shipped in T-181 (`3479dc9`), refined in T-181a (`489c366`) for the docker-bridge case, and re-applied in T-181b (`515119a`) after a T-182 merge clobbered it. **No fix needed.**
- **§F.5 M1.1 sweep 2FA gate — ALREADY DONE.** Shipped in T-180 (`ccbecb0`).
- **§F.5 M1.2 trading kill-switch button lock — ALREADY DONE.** Shipped in T-180 (`ccbecb0`).
- **§F.5 M1.3 harvest hardcoded lots demo-gate — ALREADY DONE.** Shipped in T-178 (`a76ef37`).
- **§E reference to isInternalIp() docker-bridge bug — ALREADY FIXED.** Shipped in T-183 (`9df9172`).

**Findings that survive verification against the current main and remain real:**

- **§C.3 / §C.10 #1 — `/api/orders/place` has no `requireAuth`, uses global broker singleton, 2FA key is process-global** — confirmed against current `server.js:4550/4714/4740`. This is fixed in T-196 in the same session as this postscript.
- **§C.10 #3 — legacy unscoped routes (`/api/watchlist`, `/api/alerts`, `/api/paper/*`) leak across users** — not yet verified against current main; status unknown.
- **§C.10 #4 — no Origin check on WS upgrade** — confirmed still present in `server.js:5078-5117`.
- **§C.10 #5 — SESSION_SECRET default + non-constant-time HMAC compare + WORM Merkle anchor** — fixed in T-195.
- **§E.4 — master-key rotation has no procedure/script** — still missing.
- **§E.8 — `ats-auto-login-daemon.service` not in repo** — still missing.

**Reader instruction:** when consuming this audit doc, cross-reference each finding against the current `main` before acting. The findings flagged "RESOLVED" or "ALREADY DONE" above should be considered closed; the surviving findings are the real backlog.

---

### Three live-money risks (P0 — fix in week 1)

| # | Finding | Source | File:line | Action |
|---|---|---|---|---|
| 1 | `/api/orders/place` has no `requireAuth`. Uses module-level `broker` singleton, not `pickBroker(req)`. 2FA exemption keyed on `broker.userId` (process-global, not session-global). | §C.3, §C.5 | `server.js:4362, 4480, 4510, 4526, 4552` | Add `auth.requireAuth`. Swap `broker.placeOrder` → `(await pickBroker(req)).broker.placeOrder`. Swap 2FA key to `req.user.id`. Hard fail (not silent fallthrough) on 2FA error at `:4546`. |
| 2 | Legacy unscoped routes (`/api/watchlist`, `/api/alerts`, `/api/paper/*`) read/write module-level singletons with no `req.user.id` filter — they leak data across users. | §C.3 | `server.js:2539, 2583, 1889` | Either retire legacy routes or wrap each in `withAuth` + route to per-user DB methods. |
| 3 | No `Origin` check on WebSocket upgrade. Anonymous WS connections succeed silently (`server.js:5117`). | §C.6 | `server.js:4964, 5078-5117` | Add `verifyClient` to WebSocketServer ctor checking `req.headers.origin`. Close anonymous connections after welcome. |

### Two structural gaps (P1 — fix in month 1)

- **`server.js` is 5,279 LoC / 175 inline routes**, blocking safe extraction of order/risk paths. Strategy registry (228 lines, pure data), auth handlers (7 routes wrapping existing `users.js`), and orders+2FA block (270 lines) are the highest-ROI extracts. See §A.1.
- **No frontend unit tests at all.** 56 `.jsx` files protected only by "page renders without console errors". A typo in any of them surfaces only when a user hits that screen. See §D.6.

### Two operational risks (P1 — fix in month 1)

- **Master-key rotation has no procedure.** `SECRETS-AUDIT` mentions rotating but there's no script, no documented steps. A key compromise today = wipe-and-reonboard. See §E.4.
- **`ats-auto-login-daemon.service` is NOT in the repo.** `setup-auto-login-daemon.sh:25` expects it; the VM has a hand-rolled copy that was never committed. Fresh-checkout install fails. See §E.8.

### What's working well

- Layered trading safety (§C.5) is the strongest part: 3-layer architecture (interface → MockBroker → concrete adapters) plus an automated test (`broker-gateway-safety.test.js`) that pins the live-order call-site count at 2 and fails the build on a third.
- 519 backend unit tests in strict mode, blocking in CI (T-150).
- 80 Playwright E2E specs blocking on push (T-175).
- libsodium per-user credential sealing throughout — clean architecture.
- Audit log + WORM hash chain on every state-changing event.
- Auto-recovery on broker WS stall heals in <15 min via T-114/T-115/T-116.

### Maturity scorecard (from §F.7)

| Code quality | Tests | Security | Observability | Deployability | Docs |
|---:|---:|---:|---:|---:|---:|
| 3 | 3 | 4 | 4 | 3 | 4 |

**Average: 3.5 / 5.** Mid-stage with strong security/observability/docs and clear weaknesses (code bloat, deployability) that are *documented and ranked* — a maturity signal in itself.

---

## Table of contents

- **§A.** Backend architecture — server.js god-class, module graph, DB schema, broker gateway, WS, API surface
- **§B.** Frontend architecture — 56 jsx inventory, state model, script-tag load story, primitives, fetch pattern, bundle/load
- **§C.** Security posture — auth, CSRF, authorization, sealing, trading safety, WS, audit logging, rate limit
- **§D.** Test coverage — backend modules ↔ tests, routes ↔ E2E, trading-safety test depth, CI enforcement
- **§E.** Deploy / CI / Operations — pipeline, topology, rollback, secrets on VM, observability, logging, backup, daemon, staging, nginx
- **§F.** Technical debt + ranked roadmap — debt inventory, TODO scan, velocity, 15-item risk-weighted backlog, 90-day plan

Each section is self-contained and may be read independently. Cross-references use `§X.Y` notation.

---

## A. Backend architecture

### A.1 server.js god-class

- **Size (verified):** `deploy/backend/server.js` is **5279 lines** (`server.js:1-5279`). The next-largest file is `ai-workflows-routes.js` at 1096 lines — so server.js is **~5x** the next file and **~30%** of all backend LOC (5279 / 17988).
- **Inline route count: 175 endpoints** registered directly on `app` (`server.js:423-4943`). Plus 4 mounted sub-routers via `app.use` (`server.js:3710, 3724, 3740, 3764, 3819, 3840`).

| Mount prefix | Inline routes in server.js | Notes |
|---|---|---|
| `/api/me/*` | 34 | Mix of `withAuth(...)` closures and lazily-mounted sub-routers |
| `/api/admin/*` | 12 | Bearer-gated ops endpoints (observability, dr-status, internal/seal-token) |
| `/api/v1/me/*` | 2 only (`server.js:3784, 3819` mount + `3840` mount) | v1 surface barely exists in server.js itself |
| `/api/auth/*` | 7 (`server.js:4071-4143`) | Signup/login/verify/reset still inline |
| `/api/paper/*`, `/api/orders/*`, `/api/brokers/*`, etc. | ~120 | Single-tenant "legacy" surface, all inline |

- **Concerns inline that should be in modules (impact-ranked):**
  1. **Strategy registry — 228 lines (`server.js:1615-1842`).** Pure data; trivially extractable. **High impact, near-zero cost.**
  2. **Auth endpoints — `signup/login/logout/verify/forgot/reset` (`server.js:4071-4143`).** A `users.js` module already exists but the HTTP wrappers live here. **High impact, low cost.**
  3. **Order placement + 2FA + dry-run + cancel — ~270 lines (`server.js:4346-4631`).** Includes `VALID_*` sets, kill-switch logic, risk-gate, broker dispatch. **High impact, medium cost** (cross-cuts kill-switch + per-user broker).
  4. **Reconciliation aggregator — ~115 lines (`server.js:2808-2922`).** Holdings/cash/orders cross-broker join. **Medium impact, low cost.**
  5. **Option-chain enrichment — ~95 lines (`server.js:1465-1558`).** Spot resolution + ATM quote enrichment; depends on a non-gateway `broker.getOptionChain` (see A.4). **Medium impact, medium cost.**
  6. **Tier 62 OAuth callback + state signing — `_signState` / `_pendingNonces` (`server.js:3889-4068`).** Already referenced cross-module by `me-broker.js:720` — see A.2 circular dep.
  7. **WebSocket fan-out + 2 broadcaster intervals (`server.js:4962-5240`).** ~280 lines; coupled to module-level `broker`, `alerts`, `paper`, `wsClients`.
  8. **Hyperparameter tuner (`server.js:2281-2346`), watchlist-backtest (`2978-3042`), tax/sweep/news/portfolio handlers (`2098-2791`).**
- **Natural seams to split (ranked by ROI):**
  1. `routes/strategies.js` (data extraction — 30 min of work).
  2. `routes/auth.js` (wrap existing `users.js` — half day).
  3. `routes/orders.js` + `services/risk-gate.js` (kill-switch + rate-limit live alongside the route — couple days).
  4. `routes/portfolio.js` (read-only per-user — already 70% via `broker-resolver`; just move the routes).
  5. `services/state-signer.js` (move `_signState` out of server.js, kill circular dep — see A.2).
  6. `routes/ws.js` / `services/tick-fanout.js` (the 280-line WS block at bottom).

### A.2 Module dependency graph

- **server.js requires (top of file `server.js:13-65`):** 30 local modules — every feature module (`./brokers`, `./scanner`, `./paper`, `./autorun`, `./news`, `./tax`, `./ai`, `./sweep`, `./longterm`, `./wealth`, `./mpt`, `./factor-tilt`, `./worm-audit`, `./span-sim`, `./ip-allowlist`, `./two-factor`, `./digest`, `./cas-parser`, `./db`, `./users`, `./rebalance`, `./replay`, `./email-alerts`, `./whatsapp-alerts`, `./preflight`, `./csv-import`, `./notify`, `./alerts`, `./watchlist`, `./crypto-vault`, `./sessions`, `./login-vault`, plus the 4 NSE/MF feed modules `./nse-surveillance`, `./earnings-calendar`, `./fii-dii`, `./bulk-deals`, `./mf-data`). Plus 4 routers via lazy `require()`: `account-routes`, `me-broker`, `ai-keys-routes`, `ai-workflows-routes`. And `broker-resolver` is `require()`d in **3 different places** inline (`server.js:2636, 3793, also lazily inside routes`).
- **Circular dependency (real, broken):** `me-broker.js:720` does `require('./server.js')._signState` to reach back into server.js for OAuth state-signing. **server.js never exports `_signState`** (it's a module-local `function _signState` at `server.js:3897`). The inline fallback at `me-broker.js:723-730` is annotated by the author as "doesn't register the nonce in _pendingNonces — callback will fail." This is a bug-shaped circular dep that only works because in practice the v1 path is dead — `me-broker.js:730` even admits "we always rely on the server.js _signState being available. Most installs share the module." It does not.
- **Cross-module hardcodes for broker name (gateway leaks):** `broker-resolver.js:60` (`if (broker === 'zerodha')` plus a `// TODO: dhan, angelone, upstox`), `cron-reauth.js:79-80`, `server.js:295, 353-354, 3967, 4649, 4704, 4764, 4791`. **The "multi-broker via gateway pattern" claim isn't real for non-Zerodha brokers in any user-routed path.**
- **Modules >300 lines that warrant split:**
  - `ai-workflows-routes.js` (1096) — 14 distinct workflow endpoints; should be 1 file per workflow or grouped (critique/explain/vision/mf-pick/experiments).
  - `backtest.js` (783) — likely has strategy implementations alongside runner; split strategies from runner.
  - `me-broker.js` (762) — two routers in one file (`createMeBrokerRouter` legacy + `createV1BrokersRouter` v1) plus daemon-socket client; the v1 router alone is ~220 lines.
  - `scanner.js` (549), `db.js` (541), `ai-advisor.js` (479), `ai-keys-routes.js` (441), `paper.js` (403) — borderline; not urgent.

### A.3 DB schema review

- **Tables: 21** total. 14 in `schema.sql` (`schema.sql:1-246`), **7 declared inline in `db.js`** (`user_preferences`, `user_notifications`, `ai_calls`, `ai_experiments`, `cron_reauth_history`, plus 2 triggers). This split-source-of-truth is a maintainability hazard.
- **Per-user FKs:** every per-user table has `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` (`schema.sql:39,51,71,82,95,105,124,134,150,162,175,187,194,207,218`). `scanner_history.user_id` is **nullable** (`schema.sql:227`) — possibly intentional for global scans, but worth confirming. `news_items` is global (no user_id) — appropriate.
- **Missing/weak indexes (hot paths):**
  - `scanner_history`: has `idx_scanner_ts ON (ts DESC)` only (`schema.sql:233`); per-user queries scan. Should be `(user_id, ts DESC)`.
  - `sweep_rules` (`schema.sql:205-214`): no index on `user_id`. Hit on every `/api/me/sweep` lookup.
  - `sweep_history` (`schema.sql:216-222`): no index on `user_id`.
  - `longterm_state`: PK on user_id (`schema.sql:187`) — fine.
  - `paper_positions`: no explicit index but `UNIQUE(user_id, symbol)` (`schema.sql:129`) provides one.
- **Migrations:** No real migration framework. `_schema_version` table is created (`schema.sql:11-14`) and a single row "version 1" is inserted (`db.js:166-167`), but it's **never read or incremented**. All actual schema evolution is done by 11 `ALTER TABLE … ADD COLUMN` statements in try/catch in `db.js:43-163`, plus inline `CREATE TABLE IF NOT EXISTS` for new tables. Rolling back is impossible; schema drift across environments is invisible. **Move to a numbered-migration table that records each applied migration.**
- **Other:** auto-trim triggers (`db.js:68, 75, 123`) are pragmatic but they fire on every insert and embed magic numbers (500, 5000) — fine for now but document.

### A.4 BrokerGateway pattern

- **Interface (`brokers/gateway.js:1-106`)** is clean and small (15 methods, deliberately omitting `placeOrder`). Good safety design — there's an explicit comment at `gateway.js:3-6` about not putting `placeOrder` on the base class.
- **Substitutability is broken in two ways:**
  1. **Only 2 of 5 brokers extend `BrokerGateway`** (`mock-broker.js:24` and `zerodha-broker.js:33`). `DhanBroker` (`dhan-broker.js:52`), `UpstoxBroker` (`upstox-broker.js:15`), and `AngelOneBroker` (`angelone-broker.js:58`) are plain classes — they duck-type the interface but won't inherit defaults (e.g. `ensureSubscribed` no-op at `gateway.js:51-53`, `placeDryRun` default at `gateway.js:96-98`).
  2. **`broker-resolver.buildBroker()` hardcodes Zerodha** (`broker-resolver.js:60`) with a `// TODO: dhan, angelone, upstox` (`broker-resolver.js:75`). So even though `createBroker()` in `brokers/index.js:5-60` supports 5 brokers for the global singleton, per-user (the actual SaaS path) only works for Zerodha.
- **Leakage in server.js / cross-cutting modules:**
  - `server.js:295` gates an entire branch on `BROKER_NAME === 'zerodha'` (callback flow).
  - `server.js:353-354` filters the broker list by `r.broker === 'zerodha'` to pick a default.
  - `server.js:4649, 4704, 4764, 4791` — 4 routes refuse if `BROKER_NAME !== 'zerodha'`.
  - `server.js:1473` calls `broker.getOptionChain(...)` — **method not on `BrokerGateway`**, only on ZerodhaBroker. Mock/Dhan/Angel/Upstox would throw.
  - `cron-reauth.js:79-80` also filters by `r.broker === 'zerodha'`.
- **Verdict:** Gateway design is sound; the wiring isn't. Either commit to multi-broker (extend resolver + lift `getOptionChain` to the interface) or rename the abstraction to "Zerodha + mock-for-tests".

### A.5 WebSocket architecture

- **Single `WebSocketServer` at `/ws`** (`server.js:4964`). Max clients hard-capped at `MAX_WS_CLIENTS=200` (`server.js:64, 5079`).
- **Fan-out pattern (`server.js:4970-4993`):** one upstream subscription to the global `broker` via `broker.subscribeTicks(DEFAULT_SYMBOLS, onTick)`. On each tick: (1) evaluate global `alerts` synchronously, (2) drive global `paper.onTick`, (3) iterate `wsClients` Set and `ws.send(payload)` if `ws.symbolSet.has(sym)`.
- **Per-user subscription tracking (`server.js:5078-5234`):** each connected ws gets `ws.userId`, `ws.userEmail` (Tier 75 Phase 1 cookie-based auth), and a per-client `ws.symbolSet` built from `DEFAULT_SYMBOLS ∪ db.watchlist.list(userId)` (`server.js:5133-5148`). Clients can `subscribe`/`unsubscribe` (`server.js:5199-5232`) which mutates **only the local set**; the upstream subscription is never shrunk (explicit comment `server.js:5222-5224`: "other clients may still want these ticks").
- **Memory and scaling risks:**
  - Single upstream feed for the entire process is correct, but the **`paper` and `alerts` singletons on the tick path are global**, not per-user. With multi-tenant data in DB, having a single `paper.onTick` and global `alerts.evaluate` on the hot path is a known seam (compare with `paper_orders` table that is per-user — the runtime engine isn't).
  - JSON-serializes the tick **once per tick** (`server.js:4986`), then the loop sends to every matching client. Good.
  - At 200 clients × ~3000 symbols (Kite per-WS cap) the `symbolSet.has(sym)` filter is O(1) per client, so fan-out cost is O(clients) per tick — fine. Risk is the `wsClients.size > MAX_WS_CLIENTS` check at `server.js:5079` uses `>` not `>=`, so the actual ceiling is 201.
  - `_broadcastUpstreamStateIfChanged` runs every 10s on a `setInterval` (`server.js:5048`) — cheap.
  - The upstream subscription is only ever `await broker.subscribeTicks(DEFAULT_SYMBOLS, ...)` at boot (`server.js:4972`); new symbols arrive via `broker.ensureSubscribed(merged)` per-client at connect (`server.js:5183-5187`) and per-subscribe message (`server.js:5207`). No upstream unsubscribe path — symbol set grows monotonically across the process lifetime.

### A.6 API surface health

- **Well-named REST resources** (extracted routers do this well): `/api/v1/me/brokers` (`me-broker.js:539-744`) — `GET /`, `POST /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`, sub-actions under `/:id/actions/test`, `/:id/actions/reauth`. `/api/v1/me/account|preferences|notifications|export` (`account-routes.js`). These are clean.
- **Ad-hoc verbs in server.js (inline):** `/api/scanner/run`, `/api/news/refresh`, `/api/tax/realize`, `/api/sweep/execute`, `/api/sweep/evaluate`, `/api/portfolio/optimize`, `/api/portfolio/factor-tilt`, `/api/risk/span`, `/api/orders/place`, `/api/orders/cancel`, `/api/orders/dry-run`, `/api/orders/confirm-2fa/:token`, `/api/me/paper/promote-check`, `/api/cas/parse`, `/api/digest/send`, `/api/digest/preview`, `/api/calc/position-size`, `/api/ai/news-sentiment`, `/api/ai/position-review`, `/api/ai/strategy-explain`, `/api/ai/monthly-review`, `/api/tune`, `/api/admin/email-test`, `/api/admin/internal/bulk-rotate`, `/api/admin/internal/seal-token` — ~25 verb-shaped endpoints.
- **Naming inconsistencies — the v0/v1 split is *accidental*, not deliberate:**
  - Only **2 endpoints** live under `/api/v1/*` directly in server.js (`/api/v1/me/orders/by-mode` at `server.js:3784`, `/api/v1/oauth/zerodha/callback` at `server.js:4068`).
  - `me-broker.js` exports **both** `createMeBrokerRouter` (legacy `/api/me/broker`) and `createV1BrokersRouter` (`/api/v1/me/brokers`) — author intent for migration is in `server.js:3837` ("RESTful, versioned, plural nouns. Mounted alongside legacy /api/me/broker for 30-day backward-compat window").
  - Tier 84 account-routes are mounted *only* under `/api/v1/me/*` (`server.js:3819-3834`) — no legacy alias. So `/api/v1/me/preferences` exists but `/api/me/prefs` is a separate, older endpoint (`server.js:2751`). Two parallel naming conventions live at once.
  - **The "v1" prefix means three different things in this code:** (a) the new resource-shaped router from me-broker, (b) Tier 84 net-new endpoints, (c) one ad-hoc Tier 82 orders-by-mode route. There is no documented v1 contract.
- **Response-shape consistency:** in `server.js`, ~157 `res.json(...)` calls, but only ~67 wrap success in `{ok:true,...}` (vs 341 references to `ok:false`). Extracted routers (`me-broker.js`, `account-routes.js`, `ai-keys-routes.js`) consistently use `{ok:true,...}`. **Inline server.js endpoints frequently return bare objects** (e.g. `/api/symbol/:symbol`, `/api/quote/:symbol`, `/api/historical`, `/api/strategies`). Frontend must branch on shape per endpoint.

### A.7 Top 5 backend refactor recommendations

1. **Kill the `me-broker.js` ↔ `server.js` circular dependency and extract the OAuth state signer.** `me-broker.js:720` does `require('./server.js')._signState` for a property server.js never exports (`server.js:3897` is a module-local `function`); the fallback at `me-broker.js:723-730` is self-acknowledged broken. **Do this:** create `services/oauth-state.js` exporting `signState`/`verifyState` with the `_pendingNonces` map; have both server.js and me-broker.js require it.
2. **Make `broker-resolver.js` actually multi-broker (or rename it).** `broker-resolver.js:60-77` hardcodes `if (broker === 'zerodha')` and has `// TODO: dhan, angelone, upstox`. Same TODO appears in `cron-reauth.js:79-80` and `server.js:295,353,4649,4704,4764,4791`. **Do this:** push per-user construction into a `buildPerUserBroker()` method on each adapter (or a `BrokerFactory` table keyed by name) so resolver becomes a 10-line dispatch — and so the SaaS BYOK path works for non-Zerodha brokers as advertised.
3. **Lift the Kite-only methods onto `BrokerGateway` or relocate the routes.** `broker.getOptionChain(underlying, expiry)` is called at `server.js:1473` but only implemented on `ZerodhaBroker` (the gateway interface at `brokers/gateway.js:1-106` doesn't declare it). Plus three concrete brokers (`dhan-broker.js:52`, `upstox-broker.js:15`, `angelone-broker.js:58`) don't even `extends BrokerGateway`. **Do this:** add `getOptionChain` (and `getOptionExpiries`) to `BrokerGateway` with a default empty impl, and `extends BrokerGateway` on all five adapters.
4. **Introduce a real migrations system.** `db.js:43-163` has 11 try/catch `ALTER TABLE ... ADD COLUMN` statements plus 7 inline `CREATE TABLE IF NOT EXISTS` declarations (`user_preferences`, `user_notifications`, `ai_calls`, `ai_experiments`, `cron_reauth_history`, plus 2 triggers) that should live in `schema.sql`. The `_schema_version` table at `schema.sql:11-14` is created but only ever holds version=1 (`db.js:166-167`). **Do this:** numbered files under `deploy/backend/migrations/0002_add_test_columns.sql` etc., applied in order against `_schema_version`, with a check that schema.sql contains the cumulative result.
5. **Split server.js into a routes/ tree — start with the two highest-ROI extracts.** server.js is 5279 lines / 175 inline routes. Two low-risk wins first: (a) `routes/strategies.js` — move the 228-line `STRATEGIES` array (`server.js:1615-1842`) and the trivial `GET /api/strategies` handler; (b) `routes/auth.js` — move the 7 `/api/auth/*` handlers (`server.js:4071-4143`) next to the existing `users.js` module they already call. Then tackle `routes/orders.js` (the 270-line block at `server.js:4346-4631`) with a co-located `services/risk-gate.js` for the kill-switch + rate-limit logic. Also fix the missing-index on `scanner_history(user_id, ts DESC)` (`schema.sql:233`) and `sweep_rules(user_id)` / `sweep_history(user_id)` while you're touching the schema for #4.

## B. Frontend architecture

### B.1 Component architecture overview

**File inventory (56 .jsx, ~20.6k LOC):**

| Bucket | Count | Files |
|---|---|---|
| Routable screens | 36 | `screen-*.jsx` (matches the `screens` map in `app.jsx:202-240`) |
| App shell / root | 2 | `app.jsx` (310 LOC), `shell.jsx` (649 LOC — sidebar + topbar + KillSwitchButton) |
| Shared primitives | 4 | `primitives.jsx`, `r8-primitives.jsx`, `r10-additions.jsx`, `r11-additions.jsx` |
| Cross-cutting widgets | 4 | `modals.jsx`, `charts.jsx`, `command-palette.jsx`, `r8-ai-assistant.jsx`, `r9-additions.jsx` |
| Banners / toasts | 4 | `broker-banner.jsx`, `ticker-stall-banner.jsx`, `disclaimer-footer.jsx`, `order-toast-bridge.jsx` |
| Data plumbing | 3 | `mock-data.jsx`, `market-data.jsx`, `live-ticks.jsx` |
| Domain helpers | 2 | `trading-modes.jsx`, `ai-feedback.jsx` |

**Naming.** `screen-*.jsx` is consistent and works well. The pain is the **`r8` / `r9` / `r10` / `r11` / `r8-additions` / `r8-primitives` / `r8-ai-assistant` family** (`src/r8-primitives.jsx:1`, `src/r9-additions.jsx:1`, `src/r10-additions.jsx:1`, `src/r11-additions.jsx:1`). These were originally "design-audit round N" deliverables and the names froze. Today they are a grab-bag of unrelated primitives — `r8-primitives.jsx` is `ToastHost + ErrorBoundary + Skeleton + Tooltip + NetworkStatus + BulkActionsBar + AbsTime`; `r9-additions.jsx` is `csvDownload + useSavedViews + AICostCard + LoginHistory + Leaderboard + ApiDocsScreen` (`src/r9-additions.jsx:2-7`). A newcomer cannot guess that the global `Skeleton` lives in r8 vs r10 vs r11. **Recommend rename to function (`primitives-toast.jsx`, `primitives-skeleton.jsx`, `widgets-cost.jsx`, etc.)** — this is a 30-min mechanical rename guarded by the existing CI script-tag-load test.

**Routing.** Hash-based, single component switch (`app.jsx:202-240`). Each screen is unconditionally mounted under `<ErrorBoundary>` (`app.jsx:256-258`). 6 routes are conditional on `window.X` existing (`app.jsx:234-239`) — a fragile late-load handshake that uses a `screens-changed` event + a 500ms re-poll (`app.jsx:96-102`). This is a workaround for the script-tag model, not a deliberate design.

### B.2 State management model

Every screen is `React.useState`-only — no Context, no reducer-based stores, no Zustand/Redux. `window.atsCurrentUser`, `window.atsBrokerStatus`, and a `ats-auth-changed` CustomEvent (`app.jsx:73-86`) are the global state bus.

**useState density by screen** (`grep -cE "(React\.)?useState\(" src/screen-*.jsx`):

| Screen | Count | Status |
|---|---|---|
| `screen-paper.jsx` | **29** | Three independent forms in one file (PaperBacktest L17-28, OrderForm L158-167, SpanCalc L343-346, PaperScreen L538-548). Should split into 3 sub-components; OrderForm in particular is a candidate for `useReducer` over a form object. |
| `screen-brokers.jsx` | **23** | `BrokerConnectModal` alone has 13 useStates (L86-98) — every form field is its own setter. Classic form-state pain. |
| `screen-ai-keys.jsx` | 23 | Already refactored in T-187 — now split into shell + KeyVault + ExperimentsPanel + UsagePanel (`src/screen-ai-keys.jsx:13-57` documents the map). Pattern is good; reuse for next refactors. |
| `screen-settings.jsx` | 15 | Acceptable after T-189/T-192 — three forms each tracking server snapshot + dirty flag (`src/screen-settings.jsx:88-115`). Per-section save was introduced; pattern is healthy. |
| `screen-dashboard.jsx` | 15 | Mixed — many are local KPI loaders, not coupled. |

**Where Context/Reducer would pay off:**
- `window.atsCurrentUser` / `window.atsBrokerStatus` (`app.jsx:73-86`) → an `AuthContext` would let screens drop `if (!window.atsBrokerStatus) return null` guards and eliminate the `ats-auth-changed` CustomEvent.
- Demo flag (`isDemoOn` repeated literally 20+ times across screens — see §B.6) → trivial Context win.
- `screen-brokers.jsx:86-98` and `screen-paper.jsx:158-167` are textbook `useReducer({ field, value })` candidates.

The codebase doesn't yet need Zustand. The T-187 pattern (one shell component owning server state + props down to functional sub-components) is the right next step for `screen-paper` and `screen-brokers`.

### B.3 Script-tag load model

**Why no bundler.** `deploy/build/transform.js:11-12` is explicit: each `.jsx` becomes a standalone `.js` that still loads as its own `<script src="...">` in `app.html` to preserve the 52-tag load order and "all `window.X = X` global pollution." The original goal was no dev build step; Babel-standalone was dropped (`app.html:606`) because it cost ~2MB + 2-3s of compile time. Now esbuild's `transform()` (not `build`) is used per-file in CI.

**Trade-offs accepted.**
- No tree-shaking: 20,580 lines / ~1.1 MB of source ship on every page load, irrespective of which screen the user opens.
- No minification (intentional — `transform.js:39` "keeps source readable for browser devtools").
- No source maps generated.
- No code splitting / lazy loading (`grep React.lazy src/*.jsx` returns zero).
- 58 separate `<script>` tags in `app.html:604-663`. With HTTP/2 multiplexing this is OK; on HTTP/1.1 it would be brutal.

**Cross-file dependency is via `window.X = X`.** 38 `Object.assign(window, ...)` calls export primitives globally; consumers read `window.MfPickerScreen`, `window.ToastHost`, etc. There is no static analysis of who-uses-what. The script tag order in `app.html:608-663` is the only contract — `primitives.js` must load before screens, but the order beyond that is partly accident.

**Duplicate-const guard.** `.github/workflows/ci.yml:86-108` runs a Python regex pre-commit that flags any `^const X =` declared at column 0 in more than one `.jsx`. Because every `.js` shares the same script-level lexical environment, two files declaring `const Foo = ...` at top level throws SyntaxError on page load and **silently breaks the second file's `window.X` export** (see commit fcefb3b for the Field/SettingsScreen blank-page bug noted in ci.yml:92). This guard is doing real work — but the fact that it has to exist is itself the architecture review: the script-tag model means every top-level identifier is in one global namespace, which is what bundlers exist to prevent.

### B.4 Shared primitives + duplication

**Properly extracted:**
- `Card / Stat / Pill / Chip / Toggle / Segmented / Progress / EmptyState` (`src/primitives.jsx:103-253`) — actively used (8-18 `<Card>` usages per top-consumer screen).
- `Modal` shell (`src/modals.jsx:6-43`) — the single dialog primitive.
- `ToastHost + toast() + ErrorBoundary + Skeleton + Tooltip + NetworkStatus + BulkActionsBar` (`src/r8-primitives.jsx`) — well-factored, single-file.
- Chart primitives (`Sparkline`, `AreaChart`, `Donut`, `Heatmap` — `src/charts.jsx:21,50,146,184`) — no per-screen redefinition.
- `formatINR / formatPct / inrCompact` (`src/r11-additions.jsx:19-53`, `src/primitives.jsx:81-98`) — duplicated namespacing (both files ship Indian-number formatters with slightly different APIs). **Pick one.**

**Duplication that bleeds:**
- **Two skeleton implementations.** `Skeleton` in `src/r8-primitives.jsx:108` (global) AND `SettingsSkeleton` in `src/screen-settings.jsx:25-30` (local, same shimmer keyframes redeclared inline).
- **Two relative-time helpers.** `_relTime` in `src/screen-settings.jsx:79-85` AND `_akRelTime` in `src/screen-ai-keys.jsx:92-99` — byte-identical logic. Should be `window.relTime` in primitives.
- **Inline "card with header" pattern** reimplemented in `src/screen-settings.jsx:47-77` (`Section` component) instead of using `<Card title sub>` from primitives. (Reasonable here — `Section` adds danger styling and `savedAt` — but it should *compose* `Card`, not replace it.)
- **Toggle primitive underused.** `<Toggle>` is used in only 3 screens; the rest hand-roll switches with raw `<input type="checkbox">` (3 in `screen-brokers.jsx`, 1 each in `screen-harvest`, `screen-alerts-builder`, `screen-ai-keys`).
- **Loading state has no standard.** Most screens use `if (!data) return null` (e.g. `screen-portfolio.jsx:250-268`). `screen-dashboard.jsx:200-218` returns `null` per-card. `screen-paper.jsx:597` conditional-renders on `livePaper`. Only `Skeleton.Card` from r8 is the canonical answer, but it is used in ~3 screens.

### B.5 Data fetching pattern

**Two parallel patterns, ~60/40 split:**

`window.fetchApi(path, init)` (`src/mock-data.jsx:87-110`) is the canonical wrapper. It sets `credentials:'include'`, stashes `x-request-id` onto the error + `window._lastRequestId`, parses JSON error bodies, and exposes `window.toastError` and `window.formatErr` helpers (`src/mock-data.jsx:115-143`). **`screen-dashboard.jsx` uses it 19 times**, `screen-money.jsx` 10 times, `screen-compliance.jsx` 8 times.

But these screens **bypass** the wrapper and hit raw `fetch('/api/...', { credentials: 'include' }).then(r => r.json())`:

| Screen | raw `fetch` | `fetchApi` |
|---|---:|---:|
| `screen-ai-keys.jsx` | 22 | 0 |
| `screen-settings.jsx` | 10 | 0 |
| `screen-brokers.jsx` | 8 | 3 |
| `screen-ai-advisor.jsx` | 6 | 0 |
| `screen-signals.jsx` | 5 | 2 |
| `screen-strategy-lab.jsx` | 3 | 0 |

Raw-fetch screens silently lose the request-id correlation hook for backend logs (the entire point of T99-T79 — see `mock-data.jsx:82-87`). They also re-implement error handling inline; `screen-settings.jsx:206-216` swallows non-OK responses into a `flash()` toast with `j.detail` while losing the request-id.

**Loading-state pattern: there isn't one.** Three idioms coexist:
1. `if (!data) return null` (~70% of screens — `screen-portfolio.jsx:250-268`)
2. Inline `data ? <view> : <Skeleton.Card/>` (~20%)
3. Render fallback string `"loading…"` inside the data row (`screen-dashboard.jsx:338,1024`)

**Recommend:** lint rule (or a CI grep) to ban `fetch('/api` outside `mock-data.jsx`. Convert holdouts to `fetchApi`.

### B.6 Demo-mode gating

The DEMO flag is in a confusing state. `src/primitives.jsx:241-246` says **"T83: demo mode killed. setDemoMode and useDemoMode return stable no-ops"** and `localStorage.removeItem(DEMO_KEY)` is called on load. `src/r11-additions.jsx:64` `const DemoBanner = () => null;`. **But `window.MockData.isDemoOn()` (`src/mock-data.jsx:56-59`) is still wired and 20+ screens still call it as a guard** — it now always returns `false` in production, so the `if (isDemoOn()) return;` early-returns in 15+ screens are dead code that nobody has cleaned up.

**Concrete bleeding examples:**
- `src/screen-paper.jsx:567-591` — `accounts`, `paperOrders`, `paperVsLive` are **always rendered** (line 668 onward uses them). The `livePaper` fetch (L552-563) renders an *additional* "Live paper account" card *above* the mock tables instead of replacing them. So a logged-in user with a live paper account sees real-data card #1 and mock-data tables #2-#5 stacked. The `isDemoOn()` check at L550 only skips the fetch — not the mock render.
- `src/screen-portfolio.jsx:247-269` — correct pattern: if demo, `setHoldings([])`; otherwise fetch. No mock array touched in render.
- `src/screen-circuits.jsx:53-54` — `useState((isDemoOn() ? __mockHalts : []))` — correct.
- `src/screen-ai-review.jsx:117-124` — gates KPI render on `_isDemo`, but the page still contains seeded `__mock*` arrays at module scope that exist purely to be conditionally rendered.

**The pattern is half-converted.** Some screens correctly fetch-or-empty; others render mock unconditionally and "live" data is an additive overlay. The dead `isDemoMode()` shim means any flag-based mock that was working pre-T83 is now stuck on "off" but the mock arrays still ship in the bundle.

### B.7 Bundle / load performance

**Raw cost.** 1.1 MB of `.jsx` source, transformed to roughly equivalent `.js` (esbuild adds little overhead, no minification). Plus React 18 dev build via unpkg (`app.html:604-605`) — **React.development.js + ReactDOM.development.js are ~1.2 MB unminified**. This is a dev build shipped to production.

**Critical path on cold load:**
1. HTML + tokens.css inline → ~30 KB.
2. Two React UMD scripts from unpkg (~1.2 MB, blocking, but cacheable).
3. 56 separate `.js` files served by nginx, ~1.1 MB total. On HTTP/2 these multiplex; on HTTP/1.1 you'd see a ~6-concurrent waterfall.
4. App boot fetches `/api/auth/me` then `/api/me/broker` (`app.jsx:68-87`) — gating render.
5. Each screen mounted fires its own `useEffect` fetches (dashboard alone hits 6 endpoints in parallel — `screen-dashboard.jsx:181-188`).

**Estimate.** On a fast desktop + HTTP/2 + nginx: ~600-900ms to first paint with React dev build. On a 4G mobile (the responsive CSS at `app.html:563-597` shows this is a supported viewport): ~3-5s. Switching to `react.production.min.js` is a one-line change worth ~700ms.

**No code splitting.** Every screen ships even if the user only ever opens the dashboard. `screen-brokers.jsx` (787 LOC), `screen-paper.jsx` (883), `screen-ai-keys.jsx` (1099), `screen-dashboard.jsx` (1186) all ship for everyone. With a real bundler + `React.lazy`, the dashboard-only path could be ~300 KB instead of ~1.1 MB.

**Runtime.** Once loaded the app is snappy — vanilla useState, no reconciler-stress patterns, sparkline charts are inline SVG.

### B.8 Top 5 frontend refactor recommendations

1. **Adopt a bundler (esbuild or Vite) and lazy-load screens.** Evidence: `app.html:608-663` 58 script tags; `deploy/build/transform.js:11` explicitly preserves per-file output; `app.jsx:202-240` mounts everything synchronously; React **dev** builds in production at `app.html:604-605`. *Do this:* replace `transform.js` with `esbuild build --splitting --format=esm --outdir=out/src src/app.jsx`, switch CDN URLs to `react.production.min.js`, wrap each screen in `React.lazy()` + `<Suspense>` in `app.jsx:202`.

2. **Kill the dead demo-mode path or finish the migration.** Evidence: `src/primitives.jsx:241-246` ("T83: demo mode killed"), `src/mock-data.jsx:56-59` (`isDemoOn` still wired), 20+ screens still call it. `src/screen-paper.jsx:550-591` shows the worst-case where mock arrays render unconditionally and live data is *additive*. *Do this:* delete `MockData.isDemoOn`, `isDemoMode`, `useDemoMode`, `setDemoMode`; rip every `if (isDemoOn()) return;` guard; move remaining `__mock*` arrays into a `dev-fixtures/` directory that doesn't ship.

3. **Mandate `window.fetchApi` for every `/api` call (rename to `window.api` and put it on a Context).** Evidence: `src/screen-ai-keys.jsx` has 22 raw fetches and 0 fetchApi; `src/screen-settings.jsx` 10/0; both lose request-id correlation. The wrapper exists (`src/mock-data.jsx:87-110`) and is good. *Do this:* CI grep that rejects `fetch('/api` and `fetch("/api` outside `src/mock-data.jsx`; convert the 7 holdout screens (mostly mechanical).

4. **Split `screen-paper.jsx` (29 useStates) and `screen-brokers.jsx` (23 useStates) following the T-187 pattern.** Evidence: `screen-paper.jsx:17-28, 158-167, 343-346, 538-548` — four independent forms in one file; `screen-brokers.jsx:86-98` — 13-field connect modal with one useState per field. The pattern is already proven in `screen-ai-keys.jsx:13-57` (shell owns server state, sub-panels own form state). *Do this:* extract `PaperBacktestForm`, `PaperOrderForm`, `SpanCalcForm` from `screen-paper.jsx`; collapse `screen-brokers.jsx` `BrokerConnectModal` form state into one `useReducer({field, value})`.

5. **Rename `r8/r9/r10/r11-*.jsx` to function-named primitives and collapse duplicates.** Evidence: `src/r8-primitives.jsx:1-2` (Toasts + ErrorBoundary + Skeleton + Tooltip + 3 more in one file); `src/r9-additions.jsx:2-7` (8 unrelated widgets); `_relTime` (`screen-settings.jsx:79`) and `_akRelTime` (`screen-ai-keys.jsx:92`) are byte-identical; `formatINR`/`inrCompact` exist in both `r11-additions.jsx:19` and `primitives.jsx:84`. *Do this:* rename files by function (`primitives-feedback.jsx`, `primitives-format.jsx`, `widgets-cost.jsx`); hoist `relTime` and a single INR formatter; update `app.html` script-tag list. The duplicate-const CI guard (`.github/workflows/ci.yml:86-108`) will catch any accidental collisions during the move.

## C. Security posture

**Scope:** Authentication, CSRF, authorization, credential sealing, trading-safety stack, WebSocket, audit logging, rate limiting, live-traffic exposure. Builds on `deploy/docs/SECRETS-AUDIT.md` (T-187) and extends with protocol/architecture findings the existing audit did not cover.

### C.1 Authentication

Two parallel session systems coexist, which is a maintenance/clarity risk:

- **DB-backed (`users.js`, `ats_sid` cookie):** `createUsers()` issues a 32-byte hex session id stored in `user_sessions` (FK CASCADE on users). Cookie attributes (`users.js:51`): `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age` 30 days (`SESSION_TTL_MS`), `Secure` only when `secureCookie=true` (passed as `ENV_NAME==='prod'` at `server.js:246`). Lax + 30-day TTL is a long window for a route that can place live orders — recommend halving to 7 d for sessions that have ever touched `/api/orders/place`.
- **Legacy HMAC-signed (`server.js:382-387`, `ats.sid` cookie):** Cookie value is `${sid}.${HMAC_SHA256(sid, SESSION_SECRET)}`. `httpOnly:true, secure:true, sameSite:'lax', maxAge: 7d`. The HMAC verification (`server.js:388-396`) is **not constant-time** (`sign(sid) !== mac` is a leaky `===`). Realistic timing-attack risk is low over the network but trivial to fix with `crypto.timingSafeEqual`.

**Password hashing.** bcrypt cost 12 (`users.js:29`), `~250 ms` per attempt on the Ampere A1. Login pre-hashes a dummy when the email is unknown (`users.js:105`) to defeat enumeration. **Lockout:** 5 consecutive failures lock the account 15 min (`users.js:118-120, 32-33`). No IP-based brute-force lockout — an attacker rotating through user emails will not trip per-account lockout.

**TOTP.** `two-factor.js` is *not* TOTP-based — it's a per-day Telegram confirm-before-trade. The TOTP seed referenced elsewhere is for Zerodha auto-login (`/var/lib/ats/tokens/_zerodha-login.enc`), not for human MFA. **There is no second factor on the human login flow.** Recommended for an account that can place orders.

**Password reset.** 1-hour TTL token, single-use, force-purges all sessions on reset (`users.js:214`). Email enumeration is mitigated via constant-`ok` response (`users.js:184`).

### C.2 CSRF defense

**Critical gap to investigate.** `deploy/docs/SECRETS-AUDIT.md:104-106` claims live probes return `403 cross_origin_rejected` and references "T-181" CSRF defense. **The grep sweep for origin-check middleware in the codebase returned zero hits** in `backend/` for `cross_origin`, `req.headers['origin']`, `verifyOrigin`, `sameOrigin`. The only `Origin` reference in `server.js` is `Access-Control-Allow-Origin: *` on `/api/status` (line 744). Either:

- the production-deployed build has a CSRF layer that did not make it into the working tree at `cdaca7f`, or
- the SECRETS-AUDIT response shown for probe 6a/7 reflects a different rejection (the `KILL_SWITCH` 503, the IP allowlist 403, or a missing-cookie 401) and was misattributed to a CSRF layer, or
- the doc reflects an intent that didn't ship.

The T-193 E2E sweep this session DID observe `403 cross_origin_rejected` against production — so the protection IS active in deployed code. **This means the grep missed the implementation — recommended action: re-run the search with broader terms (e.g. `verifyClient`, `corsCheck`, `originGuard`) and check `account-routes.js` / `me-broker.js` middleware chains, since the response shape suggests an Express middleware that returns that exact reason string.** Until reconciled, treat the CSRF posture as "verified at the edge, source unverified in the local working tree."

`nginx` does correctly strip `X-ATS-Internal` (`ats.rajasekarselvam.com.conf:126`, `proxy_set_header X-ATS-Internal ""`) — that defense-in-depth pattern works for `requireInternal()` routes but is **unrelated** to CSRF for normal user routes.

### C.3 Authorization

**Order placement is not auth-gated (CRITICAL).** `app.post('/api/orders/place', ...)` (`server.js:4362`) has no `requireAuth`, no `req.user` check, and uses the **global `broker` module-level singleton** (`server.js:4480, 4510, 4552`), not `pickBroker(req)`. Consequences:

- Anyone reaching the backend with the right Origin (post-CSRF fix) and a valid session-cookie-equivalent could place an order on the OPERATOR's Zerodha account.
- The 2FA "userId" key at `server.js:4526` falls back to `broker.userId || broker.name` — i.e. `ARS209` or `'zerodha'` regardless of the calling user. So the first-order-of-day exemption is process-wide, not session-wide: one user's confirmation exempts every user for the rest of the day.
- Strangely, the **confirm-2fa** route DOES call `pickBroker(req)` (`server.js:4572`). The two halves disagree about whose broker is executing.

`/api/orders/cancel` (`server.js:4609`) has the same shape (no `requireAuth`, uses `pickBroker(req)` — at least it uses the user's broker, but anonymous callers can attempt cancels).

**Legacy singletons leak across users.** `/api/watchlist` (`server.js:2539`), `/api/alerts` (`server.js:2583`), `/api/paper/*` (`server.js:1889-1927`) all call module-scoped singletons (`watchlist.list()`, `alerts.list()`, `paper.stats()`) with no `req.user` filter. A new per-user surface (`/api/me/watchlist`, with `withAuth`, `server.js:3231`) exists in parallel — but the legacy routes are still mounted and still serve global state to any caller.

**The good parts.** `withAuth` (`server.js:3178`) plus `auth.requireAuth` in delegated routers (ai-keys, advisor, account, v1 brokers, me-broker — see `server.js:3715-3845`) do enforce `req.user`. `db.js` prepared statements (`db.js:206-265`) all carry `WHERE user_id = ?`. Schema enforces `user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE` on every per-user table (`schema.sql:39, 51, 71, 82, 95, 105, 124, 134, 150, 162, 175, 187, 194, 207, 218, 227`). `requireInternal()` (`server.js:4735`) is correctly defense-in-depth (loopback/RFC1918 + header).

### C.4 Credential sealing

`crypto-vault.js` uses libsodium `crypto_secretbox_easy` with a 24-byte random nonce per seal, output is `base64(nonce || ct)`. Master key is 32 bytes at `/etc/ats/master.key`, chmod 400, root-only (`crypto-vault.js:30`). Decryption failure throws (`crypto-vault.js:74`). **Cryptographically sound.**

Sealed at rest:
- `broker_accounts.api_key/refresh_token/access_token/totp_seed/feed_token` (Zerodha + Angel + Dhan + Upstox per-user creds)
- `ai_keys.sealed_key` (Anthropic/OpenAI/Gemini BYOK)
- `user_notifications.telegram_bot_token`
- `/var/lib/ats/tokens/_zerodha-login.enc` (auto-login bundle)
- `/var/lib/ats/tokens/<userId>.enc` (legacy per-user Zerodha tokens, `sessions.js:51-54`)

**Gaps.**
- **No key rotation story in code.** Re-keying requires unseal-all → reseal-all with the new key; no migration script is in the tree. `INCIDENT-RUNBOOK.md` mentions rotation conceptually but the operational tooling is absent.
- **Bulk-rotate exposes plaintext over loopback.** `POST /api/admin/internal/bulk-rotate` (`server.js:4844-4884`) unseals ALL eligible users' `api_key + api_secret + totp_seed + password` and returns them in a JSON response over loopback to the Playwright host. The boundary (loopback + `X-ATS-Internal: 1` header, with nginx strip) is correct, but: (a) plaintext credentials transit unencrypted between container and host, (b) credentials are present in the Node response body buffer briefly, (c) the audit event `bulkrotate.bundle.served` only records the *count*, not the request id, so forensic correlation if the daemon process is compromised is weak.
- **`SESSION_SECRET` default** (`server.js:83`): `'dev-only-change-me'`. If the prod env file is misconfigured, the HMAC over `ats.sid` cookies is forgeable. There is no runtime fail-loud assertion that the secret changed from the default in prod.

### C.5 Trading safety — full path

**Layered defense (this is the strongest part of the system):**

- **Layer 1 (interface):** `BrokerGateway` has no `placeOrder/cancelOrder/modifyOrder` (`brokers/gateway.js:3-7, 93-98`). Only `placeDryRun`.
- **Layer 2 (default broker):** `MockBroker` has no `placeOrder` (`brokers/mock-broker.js` grep shows none; `brokers/index.js` defaults to mock when `BROKER` unset).
- **Layer 3 (concrete adapters):** Zerodha (`zerodha-broker.js:650`), Dhan (`dhan-broker.js:164`), AngelOne (`angelone-broker.js:193`) all implement it.
- **Test pins both:** `test/broker-gateway-safety.test.js:37-67` asserts Layer 1 and 2; line 79-124 asserts there are exactly **2** `broker.placeOrder(...)` call sites in `server.js` (post-2FA fallthrough at `server.js:4552`, confirm-2fa at `server.js:4580`), failing the build if a third appears.

**Gates on the live path (`server.js:4362-4561`):**

1. Payload validation incl. `algoId` requirement for SEBI traceability (4367-4398).
2. `KILL_SWITCH` (default `true`, line 68) — hard 503 at 4424.
3. `LIVE_TRADING` (default `false`, line 71) — hard 503 at 4437. Two independent env flags.
4. `_orderRateOk()` — 30 orders/min global, in-memory (`server.js:74, 92-96, 4449`).
5. `MAX_POSITION_SIZE_INR` per-order notional cap ₹5L (line 75, 4462).
6. `MAX_AGGREGATE_EXPOSURE` ₹20L cap (line 76, 4484).
7. `MAX_DAILY_LOSS_INR` proxy from paper realizedPnl (line 73, 4499) — **note:** uses paper realizedPnl as a proxy, not real broker P&L; under live trading this becomes a guess.
8. `typeof broker.placeOrder !== 'function'` — 501 (4510).
9. 2FA Telegram confirm (4525-4544).

**Single points of failure.**
- **Auth gate missing** (§C.3) — every safety check assumes the caller is authorized to place an order on this server's broker. They aren't being asked.
- **`broker.userId` fallback in 2FA key** (line 4526) means 2FA exemption is process-global. If user A confirms at 09:15, user B's first order at 09:16 skips 2FA.
- **`twoFactor.disabled` check** (`two-factor.js:67`) — setting `DISABLE_2FA=true` env removes the only out-of-band confirmation step. Defense relies entirely on the operator not flipping that flag.
- **`broker.placeOrder` 2FA error path** (`server.js:4546`) silently falls through on any error inside the 2FA try. A bug in `twoFactor.issue` would route the order straight to broker. Recommend changing this to a hard fail (return 503) — the comment claims "must not block" but for live orders, defaulting open is wrong.

### C.6 WebSocket security

Upgrade flow at `server.js:5078-5167`. Cookie is read via `readSessionCookie()` (legacy `ats.sid`), HMAC verified, session looked up in DB. **`ws.userId` is set on success but failure is silently swallowed (`server.js:5117`) — the connection proceeds as `userId: null`.** The audit event records `authed:false`, which is good. Max 200 clients (`MAX_WS_CLIENTS`, `server.js:79, 5079`).

**Welcome packet** (`server.js:5150-5167`) exposes: `broker.name`, `killSwitch`, `liveTrading`, `symbols`, `defaultSymbols`, `watchlist`, `authed`, `userId`, `userEmail`. The `userEmail` field will return the email tied to the cookie — for an anonymous WS, `userId/userEmail` are `null`, so this is safe. **However:** `userId` is an internal numeric DB id, which is fine; if it were ever swapped for the Kite client id (ARS209-like), it would leak a broker identifier on every welcome.

**Channel subscription gating.** `subscribe`/`unsubscribe` messages (`server.js:5199-5232`) accept any symbol the user requests and only filter at fanout via `ws.symbolSet`. No per-user permission check — this is fine for public market data, but if the broker ever streams private/order-update channels through the same WS, that filter is not a security boundary. Note also no rate limit on subscribe messages (a client could `subscribe` 200 symbols in a tight loop and force repeated `broker.ensureSubscribed` upstream).

**No `Origin` check on the WS upgrade.** A page on `evil.example.com` can open `wss://ats.rajasekarselvam.com/ws` with the user's cookie and read their watchlist + tick stream. Same root cause as §C.2.

### C.7 Audit logging + WORM

Two parallel logs (`server.js:102-116`):
- **`/var/log/ats/audit.log`** — append-only JSON-lines, monotonic `seq`, env name, event, data. `fs.appendFileSync` is synchronous; **a failed audit write `process.exit(1)`s the server (`server.js:113`)** — strong durability guarantee, but also a DoS angle if disk fills (correct trade-off for a regulated trading system).
- **`/var/log/ats/audit.worm.jsonl`** — `worm-audit.js` SHA-256 hash-chain (`prevHash + canonicalJSON(seq,ts,event,data)`), Merkle root logged every 100 entries (`server.js:255-260`). `verify()` walks the chain end-to-end (`worm-audit.js:155-185`). Genesis `prevHash` is `'0'*64`. **Tamper-evident by design**: any single-byte mutation, line deletion, line insertion, or reorder is caught.

**Limitations:**
- WORM is on the **same VM** as the originator. An attacker with root can append a fresh chain and replace the file; the Merkle roots logged to stdout/Telegram are the only off-VM anchor. The `onMerkle` hook (`server.js:256-259`) only logs to console — no external pinning (S3, blockchain, email-to-self).
- WORM lives on local disk only at boot; rotation is via the rclone-to-GDrive archive cron (`ats-archive.sh`). The chain itself is never archived contiguously — verification across rotations would require gluing snapshots back together.
- **PII in logs:** `audit('user.login.ok', { userId, email, ip })` (`users.js:130`), `audit('user.login.failed', { userId, email })` (`users.js:117`) — full email + IP go to both logs. Same for `user.reset.requested`, `user.signup`. These archive to GDrive daily. Acceptable under SEBI's traceability requirement but exposes PII if the archive bucket leaks. Order payloads (`server.js:4425, 4438, 4450, 4463, 4485, 4500, 4511`) include symbol/qty/price — not PII but trading positions of the operator.

### C.8 Rate limiting + IP allowlist

**Rate limit** (`server.js:1005-1039`): 300 req/min/IP on `/api/*`, in-memory `Map`, soft-GC at 5000 entries. **Loopback + RFC1918 IPs bypass entirely** (`isInternalIp`, line 1011-1015) — correct for cron callers but means any container on the docker bridge can hammer the API. Per-user / per-session rate limiting is **not implemented** — a single authenticated user can exhaust the per-IP budget for others sharing a NAT.

**Order rate limit** is separate (`_orderRateOk`, `server.js:92-96`): 30 orders/min **global**, not per-user. With multi-tenancy this means one user can DoS another's order placement window.

**IP allowlist** (`ip-allowlist.js`): off by default unless `API_IP_WHITELIST` is set. When enabled, supports CIDR (v4 only), `audit` vs `enforce` modes, bypass paths default to `/api/health, /api/brokers/zerodha/callback, /api/status`. `clientIp()` (line 94-107) prefers `X-Real-IP` then `X-Forwarded-For[0]` then socket. T-183 already correctly trusts nginx-set `X-Real-IP`. **However:** if the allowlist is *disabled* (default), and a user reaches the backend bypassing nginx (e.g. via a misconfigured container port-map), they could spoof `X-Real-IP` themselves — `app.set('trust proxy', 'loopback')` (`server.js:988`) bounds this to loopback callers, which is correct.

**Bypass paths in the allowlist** include `/api/status` — `/api/status` itself sets `Access-Control-Allow-Origin: *` (`server.js:744`). The two combine to expose system-state JSON (broker connection state, env name, kill-switch, build timestamp, degraded services) to any internet caller. This is intentional for monitoring but should be reviewed periodically — the build info is enumeration-friendly.

### C.9 Live-traffic exposure

Static at `/var/www/ats.rajasekarselvam.com/`, served by nginx. Backend at `127.0.0.1:8080` (loopback only, `server.js:5250` log) inside the Docker container, port-mapped to host loopback only (`docker-compose.yml`).

**Cache headers** (`ats.rajasekarselvam.com.conf:66-71`): static assets `max-age=604800, immutable`. App shell (`/`) and special pages (`/status`, `/docs`, `/legal`) get `Cache-Control: no-cache, must-revalidate`. The `immutable` directive on `.js/.jsx/.css` means a successful JS exploit (e.g. compromised CDN dependency) would persist in browser caches for 7 days even after fix. **Recommend versioned filenames** (e.g. `app.<hash>.js`) so cache-busting works.

**Security headers** (`ats-security-headers.conf`): HSTS 6 mo (no `preload`), `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` locked, **CSP allows `'unsafe-inline'` and `'unsafe-eval'`** for `script-src`. Inline+eval is required for the React-via-UMD pattern but eliminates CSP's main XSS protection. **The CSP is effectively cosmetic** for script execution — anyone landing a stored XSS can run arbitrary code. Recommend migrating to a build with hashes or nonces.

**XSS surface in inline HTML.** `server.js:4699` returns an HTML page with error message interpolated via `replace(/[<>&]/g,'')` — that strips angle brackets and `&` but leaves `"` and `'` open, which is fine here because they're in a `<p>` text node. The Zerodha success page (`server.js:4691-4696`) executes inline `postMessage` to `window.opener` with `targetOrigin: '*'` — a malicious opener could read the success ping. Low-impact (it's just `{ type: 'ats-broker-connected', broker: 'zerodha' }`), but the `'*'` should be tightened to `window.location.origin`.

### C.10 Top 5 security recommendations (ranked risk × likelihood)

| # | Finding | File:line | Risk | Remediation |
|---|---------|-----------|------|-------------|
| **1** | `/api/orders/place` has no auth check and uses the global broker singleton, not the session user's broker. The 2FA `userId` key is `broker.userId \|\| broker.name`, making the first-order-of-day exemption process-global. Any caller that reaches the backend with the right Origin/cookie can place an order on the operator's account. | `server.js:4362` (route), `4480, 4510, 4526, 4552` (global broker use) | **CRITICAL** | Add `auth.requireAuth` to the route. Replace `broker.placeOrder` with `(await pickBroker(req)).broker.placeOrder`. Replace `broker.userId` in 2FA key with `req.user.id`. Add a hard fail (not silent fall-through) on 2FA error at line 4546. |
| **2** | CSRF posture is verified at the edge (production returns `403 cross_origin_rejected`) but the implementation is not visible in the working tree at `cdaca7f`. Either grep is missing a different name or there's a tree/prod skew. Action: reconcile before trusting. | `server.js` (no implementation visible); `deploy/docs/SECRETS-AUDIT.md:104-106` (claims the feature exists) | **CRITICAL (verify)** | Re-search backend for the middleware that returns `cross_origin_rejected` (try `verifyClient`, `corsCheck`, `originGuard`). If found, document the canonical name. If missing, add origin check middleware before route dispatch: reject POST/PUT/DELETE/PATCH on `/api/*` (except `/api/auth/login`, `/api/auth/signup`, OAuth callbacks) when `Origin` is absent or not in `[https://ats.rajasekarselvam.com]`. |
| **3** | Legacy unscoped routes (`/api/watchlist`, `/api/alerts`, `/api/paper/*`) read/write module-level singletons with no `req.user.id` filter — they leak data across users. New per-user surface at `/api/me/*` exists in parallel but the old routes are still mounted. | `server.js:2539-2580` (watchlist), `2583-2610` (alerts), `1889-1927` (paper) | **HIGH** | Either retire the legacy routes (remove from `server.js`) or wrap each in `withAuth` and route to the user-scoped DB methods (`db.watchlist.list(req.user.id)` etc.). Audit other delegated routers for the same pattern. |
| **4** | No `Origin` check on WebSocket upgrade — `wss://...` connections succeed with the user's cookie regardless of the page's origin. A cross-origin page can read the user's watchlist + tick stream. Anonymous (no-cookie) WS connections also succeed silently (`server.js:5117`) instead of being rejected. | `server.js:4964, 5078-5117` | **HIGH** | Add `verifyClient` to the `WebSocketServer` ctor that checks `req.headers.origin` against the allowlist and rejects mismatches with 1008. Optionally close anonymous connections immediately after welcome rather than letting them subscribe. |
| **5** | `SESSION_SECRET` defaults to `'dev-only-change-me'` (`server.js:83`). Cookie HMAC verification uses non-constant-time `!==`. `WORM` Merkle roots are only logged to stdout, with no off-VM pinning, so a root-level VM compromise can rewrite the chain. | `server.js:83, 394`; `worm-audit.js:144-150`, `server.js:255-259` | **MEDIUM** | Refuse to boot when `SESSION_SECRET === 'dev-only-change-me'` AND `ENV_NAME === 'prod'`. Swap `sign(sid) !== mac` for `crypto.timingSafeEqual`. Wire `onMerkle` to email-to-self or Telegram-to-self every 100 entries so an external anchor exists. |

**Other notable observations:**
- TOTP/2FA missing on human login (Telegram confirm covers orders, not session bootstrap).
- `MAX_DAILY_LOSS_INR` proxies via paper realizedPnl, not live broker P&L (`server.js:4498`) — becomes a guess once `LIVE_TRADING=true`.
- 30-day session TTL (`users.js:30`) is long for an order-placing system.
- CSP allows `unsafe-inline` + `unsafe-eval` — XSS would be fully exploitable.
- `Access-Control-Allow-Origin: *` on `/api/status` (`server.js:744`) enumerates env name, broker state, kill-switch, degraded services to any caller.
- Bulk-rotate route (`server.js:4844`) returns plaintext API secrets + TOTP seeds + passwords for all eligible users in one JSON response — boundary is correct (loopback + header + nginx strip) but blast radius if the daemon is compromised is the entire user base.
- `windows.opener.postMessage(..., '*')` (`server.js:4694`) should target the origin, not wildcard.

## D. Test coverage

### D.1 Inventory

- **Backend unit tests:** 48 `.test.js` files, 519 `test()` calls. Runner: `deploy/backend/test/_runner.js`, strict mode via `ATS_TEST_STRICT=1` enforced in CI (`.github/workflows/ci.yml:106`).
- **E2E (Playwright):** 16 spec files, 53 explicit `test()` calls (61 including describe-level wrapping; for-loops over PATHS/ROUTES expand to ~80 actual test cases). Config: `test-e2e/playwright.config.js`, base URL `https://ats.rajasekarselvam.com`, retries 1, headless.
- **Frontend unit tests:** ZERO. No `.test.jsx`, no `.test.js` under `src/`, no `vitest.config.*` anywhere in the repo. P0 #3 in T-169 was explicitly **deferred** (TESTING-PLAN.md:301).

**5 largest backend test files (lines):**
1. `deploy/backend/test/alerts.test.js` — 253 lines, 19 tests
2. `deploy/backend/test/ai-router.test.js` — 252 lines, 20 tests
3. `deploy/backend/test/worm-audit.test.js` — 226 lines, 13 tests
4. `deploy/backend/test/pnl-monthly.test.js` — 220 lines, 18 tests
5. `deploy/backend/test/notify.test.js` — 201 lines, 13 tests

**5 smallest backend test files (likely thin):**
1. `deploy/backend/test/brokers.test.js` — 49 lines, 6 tests
2. `deploy/backend/test/wealth.test.js` — 52 lines, 5 tests
3. `deploy/backend/test/preflight.test.js` — 54 lines, 4 tests (stub-broker only, no failure-cascade coverage)
4. `deploy/backend/test/rebalance.test.js` — 56 lines, 5 tests
5. `deploy/backend/test/csv-import.test.js` — 59 lines, 7 tests

`observability.test.js` is also thin (4 tests, ~92 lines) for a module that gates every request — see Rec #4.

### D.2 Coverage map: backend modules to tests

**Has matching test file (named module covered):** `db`, `brokers/{angelone,dhan}`, `two-factor`, `ai-router`, `risk-engine`, `sessions`, `users`, `observability`, `paper`, `alerts`, `broker-resolver`, `autorun`, `crypto-vault`, `login-vault`, `ip-allowlist`, `notify`, `cas-parser`, `csv-import`, `factor-tilt`, `factor-exposure`, `fii-dii`, `news`, `nse-surveillance`, `pnl-monthly`, `pnl-attribution`, `preflight`, `promotion-rate`, `replay`, `rebalance`, `sector-map`, `span-sim`, `sweep`, `tax`, `wealth`, `worm-audit`, `bulk-deals`, `bulk-rotate-helpers`, `digest`, `earnings-calendar`, `longterm`, `market-meta`, `me-broker`, `mpt`, `ai-advisor`.

**Backend modules with NO matching `.test.js` (blind spots):**

| Module | LOC class | Risk |
|---|---|---|
| `server.js` | the orchestrator | Hottest file in repo; only covered transitively + via E2E |
| `scanner.js` | momentum scanner + Telegram cron | **No unit test.** `scanner-plugins.test.js` covers a DIFFERENT module (the plugin framework). RSI/EMA computation and dedup state are untested. |
| `account-routes.js` | mounts 9 routes at `/api/v1/me/*` | No unit test, no E2E (see §D.3) |
| `ai-keys-routes.js` | 8 routes — BYOK key persistence | Only `ai-keys-shape.spec.js` hits 401 path |
| `ai-workflows-routes.js` | 15 routes | Zero coverage |
| `ai.js` | top-level AI dispatcher | Zero coverage |
| `backtest.js` | strategy backtest engine | Zero coverage |
| `cron-reauth.js` | broker token reauth | Zero (and it runs on a timer) |
| `email-alerts.js`, `whatsapp-alerts.js` | notification fan-out | Zero |
| `mf-data.js` | mutual-fund NAV cache | Zero |
| `watchlist.js` | per-user watchlist store | Zero (route hit by E2E only in 401 path) |
| `migrate-*.js` | one-shot migrations | Acceptable to skip |
| `brokers/gateway.js` | the safety contract base | Only pinned by `broker-gateway-safety.test.js` Layer 1 |
| `brokers/upstox-broker.js` | live adapter | **No test.** Angel/Dhan/Zerodha have nothing either except `angelone-broker.test.js` and `dhan-broker.test.js`. `zerodha-broker.js`, `zerodha-auto-login.js`, `zerodha-instruments.js`, `mock-broker.js` all untested. |

### D.3 Coverage map: API routes to E2E specs

`deploy/backend/server.js` declares **175 `app.{get,post,put,patch,delete}` routes** (unique paths ~110). Account/ai-keys/ai-workflows routers add another **32 routes** on top.

E2E specs touch **~36 distinct paths** (extracted from `test-e2e/tests/*.spec.js`). Of those, most assertions are 401-shape or smoke "did it return 200/JSON" — not behaviour. Authed paths have zero coverage end-to-end because CI has no session cookie.

**High-risk routes with NO E2E coverage:**

- `POST /api/orders/cancel` — no spec
- `POST /api/orders/dry-run` — no spec (the sanctioned audit path)
- `POST /api/orders/confirm-2fa/:token` — no spec (the post-Telegram live-order pathway!)
- `POST /api/orders/cancel-2fa/:token` — no spec
- `GET /api/kill-switch` — no spec (server.js:2972) — the kill switch state isn't asserted anywhere
- `POST /api/auth/{login,signup,logout,forgot-password,reset-password,verify-email}` — entire auth surface untouched by E2E
- `POST /api/me/broker-test` — no spec
- `POST /api/brokers/disconnect` — no spec
- `POST /api/me/alerts`, `DELETE /api/me/alerts/:id`, `GET/PUT/DELETE /api/me/autorun` — no spec
- `GET /api/security/two-factor`, `GET /api/security/ip-allowlist` — no spec
- All 9 `/api/v1/me/*` account-routes (`account`, `prefs/v1`, `notifications` CRUD, `export`) — only `/api/v1/me/notifications` and `/notifications/test` are touched by `notifications-save.spec.js`

`/api/me/*` is partially covered — `me-endpoints.spec.js` asserts 401 on 7 paths; the other ~20 `/api/me/*` GETs and all the POST/PUT/DELETE writes are untested.

### D.4 Trading-safety test depth

`deploy/backend/test/broker-gateway-safety.test.js` (8 tests) is genuinely well-targeted:

- Layer 1 (lines 37-53): `BrokerGateway.prototype.{placeOrder,cancelOrder,modifyOrder}` are `undefined`; `placeDryRun` is a function. Solid invariant.
- Layer 2 (lines 57-69): `MockBroker` has no `placeOrder`; `placeDryRun` returns `{ok:true, mode:'dry-run', acceptedAt}`.
- Layer 3 (lines 79-124): scans `server.js` for `*.placeOrder(` and pins the count at **2** (`/api/orders/place` post-2FA fallthrough and `/api/orders/confirm-2fa/:token`). A new live-order pathway snuck in anywhere will fail this assertion.
- Bonus (lines 128-135): `.env.example` doesn't pre-enable `LIVE_ORDERS_ENABLED=true`.

**However**, this is the ONLY test pinning the safety story. Server-level gates that fire BEFORE `broker.placeOrder()` are unprotected:

| Guard | Location | Has unit test? |
|---|---|---|
| `KILL_SWITCH` short-circuit in `/api/orders/place` | `server.js:4424-4434` | **No** — referenced only as an env var read; no test exercises `KILL_SWITCH_ON` 503 response |
| `LIVE_TRADING=true` second gate | `server.js:4435-4447` | **No** |
| `_orderRateOk()` per-minute cap | `server.js:92-98, 4449-4451` | **No** — `MAX_ORDERS_PER_MIN` overflow path is untested |
| Daily realized-loss cap (`MAX_DAILY_LOSS_INR`) | `server.js:4500` | **No** — `order.blocked.dailyLoss` audit event has zero test coverage |
| 2FA TTL expiry on `/api/orders/confirm-2fa/:token` | `two-factor.js` | YES — `two-factor.test.js:90-97` exercises ttlMs=1 |
| `/api/orders/cancel` kill-switch check (`server.js:4614`) | | **No** |

The TwoFactor unit (`deploy/backend/test/two-factor.test.js`, 14 tests) is the gold standard — it covers issue, consume, reuse, expiry, telegram failure, audit hook firing. That depth needs to exist for kill-switch + rate-limit + loss-cap, which are currently only env-flag reads with no test exercising the 503 branch.

### D.5 E2E spec quality

- **`smoke.spec.js`** (4 explicit tests, expanded to 23 via the 20-route loop): asserts `#root` has children AND no `ReferenceError|TypeError|SyntaxError|is not defined|Cannot read prop` console errors per route. Stronger than "page loads" — it specifically catches the fcefb3b Field/SettingsScreen blank-page regression. Plus `/api/health` 200 + `/api/preflight` shape. **Decent depth for what it claims to guard.**
- **`happy-path.spec.js`** (13 tests, ~288 lines): genuinely exercises a happy path — anonymous landing, 4 public APIs with shape assertions, 5 protected `/api/me/*` 401 contracts, POST `/api/orders/place` returns 4xx not 2xx, 7 critical screens render without errors, JSON-404 contract, WS handshake within 5s, `/api/health-deep` field map. **Does NOT exercise a logged-in user session** — comment at line 8 of `me-endpoints.spec.js` explicitly states "We can't easily test the AUTHED path from CI (no session cookie)". The "happy path" is the anonymous + 401 shape path, not an authed user placing a paper order. Real happy-path is not tested.
- **`signals-fake-kpis.spec.js`** (1 test): grep-on-shipped-JSX for hardcoded demo strings. Negative-only assertion (no positive content check after T-173 removed those). Narrow but legitimately catches the T-81 regression class.
- **`ai-keys-shape.spec.js`** (6 tests): 401 contracts on 4 BYOK routes + SPA mounts without fatal console errors. Same auth-not-tested limitation.

**Overall E2E posture:** ~80% of assertions are "401 has the right shape" or "no fatal console error". This is fine as a regression net but provides NO confidence that an authed user can actually place an order, complete 2FA, or see correct P&L.

### D.6 Frontend test coverage

- `src/*.jsx` count: **56 files**.
- `.test.jsx` count: **0**
- `vitest.config.*` files: **0**
- Babel parse check at `ci.yml:54-79` does catch syntax errors at runtime-load — but does NOT catch:
  - Logic bugs in handlers, state reducers, fetch error paths
  - Type/shape mismatches between API response and component props
  - Typos in property accesses (`obj.foo.bar` when `foo` is null) — these surface only when the user actually hits that code path in the browser
  - The `ci.yml:84-104` duplicate-top-level-`const` guard catches one specific class (fcefb3b) but nothing else

For a 56-file SPA shipping under runtime Babel with `window.*` exports, zero unit tests is the largest single coverage gap in the codebase. Per `TESTING-PLAN.md:127`, the highest-risk screens are `screen-orders`, `screen-risk`, `screen-modes`, `screen-strategy-lab`.

### D.7 Test infrastructure smells

- **No `.skip`, `.fixme`, `xit`, `xdescribe`, or `TODO test` markers** in `deploy/backend/test/` or `test-e2e/tests/`. Encouraging.
- **`continue-on-error: true` in CI:**
  - `.github/workflows/ci.yml:36` — npm audit step (intentional per T-169 P0 #4: "Currently `continue-on-error: true` so we can review the baseline before flipping to blocking"). CVE high+ vulns will NOT fail CI today.
  - Playwright step is NOT `continue-on-error` (T-175 removed it per `ci.yml:131-135`). Blocking. Good.
- **`_runner.js` strict mode:** `ATS_TEST_STRICT=1` IS set in CI (`ci.yml:104`). Without the env var the runner defers to `node --test` exit which can mask failures in some shells (the comment at lines 51-58 of `_runner.js` documents the T-144 regression). One subtle smell: `_runner.js:67-69` exits with `r.status` when not strict, but `r.status === null` (signal-killed) maps to exit 0 — only matters if someone unsets the env var locally.
- **No coverage measurement.** No nyc/c8/istanbul anywhere. Coverage % is unknown.
- **No flake retry budget in backend tests.** Playwright has `retries: 1` (config line 5). Backend `node:test` has no retry; deterministic.

### D.8 CI test enforcement walk-through

`.github/workflows/ci.yml`:

1. **Install backend deps** (`npm ci`) — fails on lockfile drift.
2. **`npm audit --audit-level=high`** — **NON-blocking** (`continue-on-error: true`, line 36). Posts a `::notice::` annotation but never fails CI. Documented T-169 P0 #4 deferral.
3. **`node --check`** on every backend `.js` — blocks on syntax error.
4. **JSX babel-parse** on `src/*.jsx` — blocks on JSX parse error.
5. **Duplicate top-level `const` guard** — blocks (fcefb3b class).
6. **Backend unit tests** with `ATS_TEST_STRICT=1` — **BLOCKING**. T-150 confirmed.
7. **Playwright** on push to main only (skipped on PRs) — **BLOCKING** (T-175 removed `continue-on-error`). PRs do NOT run E2E, which means an E2E regression is only caught after merge — there's no pre-merge gate. Documented in `ci.yml:128-129`.
8. **Secret-leak guard** — blocks on `ZERODHA_API_SECRET=`, `BEGIN…PRIVATE KEY`, `ghp_*`, `github_pat_*`, plus committed `master.key`, `audit.log`, `tokens/` paths (T-190 expansion). **BLOCKING**.

**Not enforced in CI:** dependency vulnerabilities, lint (eslint not present), test coverage thresholds, type checking (no TypeScript), frontend unit tests (don't exist), E2E on PRs.

### D.9 Top 5 test-coverage recommendations

| # | Recommendation | File paths | Effort | Risk reduction |
|---|---|---|---|---|
| 1 | **Add server-level guard tests for kill-switch, rate-limit, and daily-loss cap on `/api/orders/place`.** Mirror the depth of `two-factor.test.js`. Stub the broker + paper, drive the request through with a session, assert the 503 reason codes (`KILL_SWITCH_ON`, rate-limit overflow audit, `order.blocked.dailyLoss`). | New `deploy/backend/test/order-guards.test.js`. Targets `server.js:4424-4500`. Test ideas: KILL_SWITCH=true returns 503/KILL_SWITCH_ON; KILL_SWITCH=false + LIVE_TRADING=false returns 503; 31st order in a minute returns rate-limit 503; realizedToday > MAX_DAILY_LOSS_INR returns 503. | M (server-import in tests is heavy — see notify.test.js for a precedent) | **Very high.** These are the actual money-safety gates. Today they're trusted by inspection. |
| 2 | **Scaffold Vitest + add component tests for `screen-orders`, `screen-paper`, `screen-risk`.** TESTING-PLAN.md:127 explicitly calls this out as deferred from T-169. Use jsdom + @babel/preset-react to handle runtime-Babel JSX. Cover: order-form validation, kill-switch state read, paper-order placement happy-path, error-state rendering. | New `vitest.config.js` at repo root, `src/screen-orders.test.jsx`, `src/screen-paper.test.jsx`, `src/screen-risk.test.jsx`. Add `npm run test:frontend` step to `ci.yml` after the JSX parse step. | M-L (one-time scaffold cost, then fast per-screen) | **High.** 56 untested screens; a typo in any of them is undetected today until a user hits the screen. |
| 3 | **Authed E2E spec covering paper-order happy path.** Today no E2E touches a logged-in session. Add a fixture that logs in a test user (signup + verify), places a paper order, asserts it shows in `/api/me/paper/order` list. Pulls the auth gates into actual test coverage. | New `test-e2e/tests/authed-paper-flow.spec.js` plus `test-e2e/tests/helpers/auth.js` fixture. Will need a CI test-user provisioned in the prod DB or (better) a `ATS_BASE_URL=http://localhost:8080` path that ephemeral-CI brings up. | L-XL (depends on whether we add staging or DB seeding) | **High.** Today 80% of E2E assertions are `401 has the right shape`; we have ~0 evidence the authed path works post-deploy. |
| 4 | **Unit tests for `scanner.js` (the daily momentum scanner with Telegram cron).** Zero coverage today on a module that auto-runs at 15:35 IST and posts to Telegram. RSI(14) calculation, EMA(20) crossover, debounce/dedup logic, history truncation at 100 are all untested. | New `deploy/backend/test/scanner.test.js`. Targets `deploy/backend/scanner.js`. Test ideas: RSI on a known bull-run series returns ~70; EMA cross detection on synthetic candles; second-fire same-day for same (symbol, signalType) doesn't double-fire; history truncates at HISTORY_MAX=100; Telegram failure doesn't crash the loop. | S-M | **Medium.** Wrong RSI = false signal = bad trade decision. |
| 5 | **Pin E2E to PRs, not just push-to-main, AND make the npm-audit step blocking.** PRs today skip Playwright entirely (`ci.yml:128`); an E2E regression only fails post-merge. Combined with making `npm audit --audit-level=high` blocking after the baseline review (T-169 P0 #4 follow-up), this closes the two known non-blocking holes. | Edit `.github/workflows/ci.yml`: remove the `if: github.event_name == 'push'` on the Playwright step (line 128); remove `continue-on-error: true` on the npm audit step (line 36). May need a `--audit-level=critical` initial step first to avoid noise. | S | **Medium.** Doesn't add tests but closes existing safety nets. |

**Supporting numbers:**
- 48 backend test files / 519 tests / strict mode enforced
- 16 E2E specs / 53 explicit tests (~80 via for-loops) / blocking on push, NOT on PRs
- 175 `app.*()` routes in server.js + 32 in routers = ~207 routes; ~36 touched by E2E (≈17%)
- 56 `src/*.jsx` files / 0 unit tests
- 15 backend modules with no `.test.js`; 5 of 9 broker files untested
- 0 skipped/fixme tests in either suite
- 1 `continue-on-error: true` remaining (npm audit, by design pending baseline)

## E. Deploy / CI / Operations

### E.1 CI/CD pipeline

**Blocking vs continue-on-error (`.github/workflows/ci.yml`):**

| Step | Blocking? | Notes |
|---|---|---|
| `validate` job, Node 20 install | YES | `actions/setup-node@v5` |
| `npm ci`/`npm install` (`deploy/backend`) | YES | line 32 |
| **`npm audit --audit-level=high`** | NO (`continue-on-error: true`) | line 36 — high+critical CVEs surface only as `::notice::`, never fail the build |
| `node --check` syntax sweep of `deploy/backend/*.js` | YES | line 50-54 |
| Static-HTML lint + Babel-parser JSX parse | YES | lines 56-84 |
| Duplicate top-level `const` guard in `src/*.jsx` | YES | lines 86-108 (Python AST-style scan) |
| **Backend unit tests (`node --test`)** | YES (since T-150 set `ATS_TEST_STRICT=1`) | line 119 |
| **Playwright E2E (80 specs)** | YES on `push` only (skipped on PRs) | lines 127-141 — `continue-on-error` was removed at T-175 |
| Secret-leak grep | YES | lines 143-163 — covers `ghp_/github_pat_` (added T-190 after SECRETS-AUDIT P0) |

**deploy.yml flow** (`/.github/workflows/deploy.yml`):
1. Re-runs `ci.yml` via `uses: ./.github/workflows/ci.yml` (line 41) — full validate must pass.
2. `build-and-push` (lines 43-85): GHCR login via `secrets.GITHUB_TOKEN`, `docker/build-push-action@v6`, `platforms: linux/arm64`, cache via `type=gha`. Bug-ish on line 75: comment says `linux/amd64` but `platforms:` is `linux/arm64` — comment misleading but build is correct for Ampere.
3. `deploy` (lines 87-190): `concurrency: group=deploy-prod, cancel-in-progress: false` (line 28) — good, no overlapping deploys. `scp`s `deploy-on-vm.sh`, `docker-compose.yml`, DR scripts, nginx configs to `/opt/ats/scripts/` and `/opt/ats/scripts/nginx-staged/`. Runs `deploy-on-vm.sh`. Then a post-deploy curl loop of `https://ats.rajasekarselvam.com/api/health` (lines 177-190, max 30 s).

**Time to deploy (green main → live):** validate (~3-6 min for full unit + 80 playwright specs) + build-and-push (~6-10 min on a cold cache, ~3-5 warm) + scp+ssh+pull+swap+health (~1-2 min) + post-deploy poll (≤30 s) ≈ **~12-18 min**.

**Where a regression can slip through:**
- `npm audit` is non-blocking (`ci.yml:36`). A new critical CVE in a transitive dep ships silently.
- No coverage threshold; tests that don't exist can't fail.
- `node --check` only checks syntax — no TypeScript, no ESLint, no semantic lint. A `console.log(undef)` ships fine.
- Playwright runs **against the live URL** (`test-e2e/`), meaning E2E hits prod, not staging. A pre-merge regression test can't validate the not-yet-deployed bits, only what's already deployed (the "blocking before deploy" timing is true, but the SUT is yesterday's prod).
- No image signing (`provenance: false` line 85, no cosign).
- No SBOM, no Trivy/Snyk image scan.
- Deploy artifacts (`docker-compose.yml`, nginx configs, DR scripts) are `scp`'d as a side channel — they bypass the image build. A change to those is never tested in CI before landing on the VM.

### E.2 Production topology

| Component | Location | Persistence |
|---|---|---|
| OCI Ampere A1 ARM64 VM | 141.148.192.4 (`INCIDENT-RUNBOOK.md:6`) | — |
| `ats-backend` container | `127.0.0.1:8080`, restart=always (`docker-compose.yml:13-17`) | ephemeral; image from GHCR |
| nginx (host, NOT containerised) | `:80/:443` → upstream `127.0.0.1:8080` (`ats.rajasekarselvam.com.conf:15-18`) | configs in `/etc/nginx/sites-available/` |
| Auto-login daemon | systemd `ats-auto-login-daemon.service` listening on `/var/run/ats/auto-login.sock` | code in `/opt/ats-auto-login/` |
| Bulk-rotate timer | systemd timer 05:45/09:00/13:00 IST Mon-Fri (`ats-bulk-rotate.timer:10-13`) | — |
| Auto-login cron | `/etc/cron.d/ats-auto-login` daily 08:50 IST | — |
| Prometheus + Alertmanager | optional; same VM, `--network host`, `:9090`/`:9093` | none documented |
| Telegram bridge | `localhost:8888`, run via `nohup node` | **no systemd unit — dies on reboot** |
| SQLite | `/var/lib/ats/tokens/ats.db` (WAL, bind-mounted) | host disk |
| Master key | `/etc/ats/master.key` (440 root:ats, mounted RO `/run/secrets/master.key`) | host disk |
| Audit log | `/var/log/ats/audit.log` (logrotate daily, 7-day retention) | host disk |
| Sealed Zerodha tokens | `/var/lib/ats/tokens/*.enc` | host disk |
| `/etc/ats/backend.env` | 640 root:ats, holds Zerodha keys + SESSION_SECRET + Telegram | host disk |
| `/etc/ats/.dr-token` | 0444 | host disk |
| rclone config | `/root/.config/rclone` | host disk |

**Blast radius if VM dies:** 100 %. No HA, no standby, no read replica, no DNS-based failover. DR-RUNBOOK.md §"Full disaster recovery" describes a manual 12-step provisioning + restore that the runbook itself says targets **RTO < 1 h** (line 13) — but a fresh `setup-ubuntu-docker.sh` → `setup-all.sh` → DNS swap → certbot → restore-from-GDrive is unlikely to fit in 1 h without rehearsal. Master key is explicitly **not** in GDrive (DR-RUNBOOK.md:44) — sole copy is the operator's Windows machine. If that laptop and the VM both die, **every sealed cell is permanently undecryptable**.

### E.3 Rollback story

`deploy-on-vm.sh` implements **automatic rollback on health-check failure**:
- Previous tag written to `/opt/ats/compose/.previous-tag` (line 53) before pinning new tag in `.current-tag` (line 54).
- Health check at line 64-70: 30 attempts × 2 s = 60 s. If failed, lines 78-94 re-`docker compose up -d` the previous tag, swap `STATIC_DIR.old` back into place, reload nginx.
- Static-dir rollback uses atomic rename: `STATIC_DIR.old` preserved during this run (line 46), wiped at line 97 after success.

**Gaps:**
- Only **N-1** depth — `.previous-tag` overwrites every deploy. Two bad deploys back-to-back lose the last known-good. No `last-good-tag` separate from `previous-tag`.
- Auto-rollback **only triggers on local health failure** (`http://127.0.0.1:8080/api/health`). A deploy that boots, passes `/api/health`, but breaks `/api/v1/oauth/zerodha/callback` will **not** auto-rollback — the post-deploy curl in `deploy.yml:177-190` would catch it, but at that point the GHA job fails AFTER the new container is live; there is no GHA-driven remote rollback.
- Manual rollback is documented only as an inline `docker pull … && docker-compose up -d` in `INCIDENT-RUNBOOK.md:174-177` (Incident 6). No `rollback-on-vm.sh` script. The operator must remember the previous SHA.
- Rollback ignores `/etc/ats/backend.env` changes — if a deploy required new env vars and the operator added them, rolling back the image to a version that doesn't tolerate them is brittle.
- **Time to rollback (auto):** ~60 s health window + ~5-15 s compose up + ~5 s nginx reload ≈ **~80-120 s** after deploy lands.
- Time to rollback (manual, via SSH+docker pull): ~2-5 min once the operator decides.

### E.4 Secret management on the VM

| Secret | Path | Perms | Source |
|---|---|---|---|
| libsodium master key | `/etc/ats/master.key` | 440 root:ats, mounted RO inside container | `openssl rand 32` in `setup-ubuntu-docker.sh:133-138` |
| Backend env (Zerodha keys, SESSION_SECRET, Telegram, SMTP) | `/etc/ats/backend.env` | 640 root:ats, mounted via `env_file:` | seeded by `setup-ubuntu-docker.sh:140-158`, operator edits in place |
| DR auth token | `/etc/ats/.dr-token` | 0444 world-readable | `head -c 32 /dev/urandom \| xxd -p` |
| GHCR pull token | `ATS_GHCR_TOKEN` env var passed via SSH at deploy time | transient (env var on the deploy ssh call) | `secrets.GHCR_PULL_TOKEN` in GitHub |
| Metrics token | `/opt/ats/.metrics_token` mode 0640 | injected via `.env` to container as `ATS_METRICS_TOKEN` | `openssl rand -hex 32` |
| Auto-login shared bearer | `/etc/ats/auto-login.env` 0640 root:docker | shared with container via env_file | generated on first install |

**Who can read:** anyone with `root` or with membership in `ats` group can read `master.key` + `backend.env`. The `deployer` user is added to `ats` (`setup-ubuntu-docker.sh:88`). That's effectively any human or process with SSH access.

**Rotation:**
- **Master key rotation is NOT documented** anywhere I could find. `SECRETS-AUDIT.md:135` only says "rotate the libsodium master key first (forces every sealed cell to be re-encrypted)" — but no script, no procedure, no verification. There is no `rotate-master-key.sh` in `deploy/scripts/`. The `account-routes.js`/`crypto-vault.js` would need bulk re-seal-with-new-key tooling; this does not exist. **A master-key compromise today = no documented recovery beyond "wipe everything and re-onboard."**
- **GHCR token rotation:** also undocumented. The PAT is stored only in GH Actions secrets (`OCI_SSH_PRIVATE_KEY`, `GHCR_PULL_TOKEN`). Manual swap in GH settings.
- **SESSION_SECRET:** `SECRETS-AUDIT.md:133` says "rotate quarterly per the `.env.example` comment" — no concrete procedure, no calendar reminder.

The `INCIDENT-RUNBOOK.md` does **not** include a rotation playbook for any of these.

### E.5 Observability

**Scrape target:** single endpoint `ats.rajasekarselvam.com/metrics` (`prometheus.yml:17-23`), bearer-token authed. The metrics endpoint (`server.js:1199-1234`) emits only **application-level gauges**: `ats_broker_connected`, `ats_broker_subscribed_instruments`, `ats_broker_ws_subscribers`, `ats_broker_reconnect_attempts`, `ats_broker_has_access_token`, `ats_broker_last_tick_ms`, `ats_broker_lag_ms`, `ats_instruments_count`, `ats_alerts_*`.

**Alerts** (`rules.yml`):
- `BrokerDisconnected` (`ats_broker_connected==0` for 2 m) — **critical**
- `NoTicksRecently` (no tick for 2+ min) — warning
- `BackendDown` (`up{job="ats"}==0` for 1 m) — critical
- `HighErrorRate` (`rate(ats_request_errors_total[5m]) > 0.5`) — warning
- `PaperPersistFailures` — warning
- `ReconcileDriftAccelerating` (`abs(ats_reconcile_cash_drift) > 100000`) — critical

**Routing:** all alerts → `telegram` receiver via local `localhost:8888/alertmanager-to-telegram` bridge (`alertmanager.yml:14-18`). The bridge itself is a **50-line script run via `nohup node` with no systemd unit** — it will die on the next VM reboot and there's no watchdog.

**Coverage gaps — failure modes that won't page:**
- No `node_exporter`, no `cadvisor` → disk-full, OOM, runaway CPU, container restart-looping, host load avg, network saturation. **Nothing.**
- No alerting on `/api/health-deep` fields: `brokerWsStalled`, `brokerAccessTokenAgeMin`, `drStale`. The runbook (`INCIDENT-RUNBOOK.md:24-26`) lists these as critical health fields, but no `alertmanager` rule consumes them.
- No nginx exporter → no 5xx-rate, no upstream latency, no rate-limit drop telemetry.
- No certificate-expiry alert (Let's Encrypt 90-day cert; certbot autorenew is the only safeguard).
- No alert if Prometheus scrape itself fails for >5 min (the `BackendDown` rule requires Prometheus to be up to fire).
- No alert if Alertmanager itself dies.
- No alert when the **telegram bridge** dies — so all of the above could already be silently broken.
- `metrics_token` lives in `/opt/ats/.metrics_token` AND in `/etc/ats/backend.env` AND in `/opt/monitoring/metrics_token` (three copies) — drift risk; if you rotate one and not the others, scrape silently 403s.

### E.6 Logging

- **Backend:** `logging.driver: journald, tag: ats-backend` (`docker-compose.yml:66-69`). Reachable via `journalctl -u docker.service` / `docker logs ats-backend`.
- **Audit log:** `/var/log/ats/audit.log`, host-side rotated daily by logrotate, 7 days local retention, compress + `copytruncate`, then `audit.log-*.gz` rclone'd to GDrive nightly. The WORM property is implemented in code (`backend/worm-audit.js`) — append-only hash-chained. Logrotate uses `copytruncate` which is **NOT** WORM-safe at the OS level (a `chmod`+truncation can clobber the file), but the backend's hash chain catches tampering.
- **Bulk-rotate log:** `/var/log/ats/bulk-rotate.log` via systemd `StandardOutput=append:`.
- **Morning-check log:** `/var/log/ats/morning-check.log`.
- **DR test log:** `/var/log/ats/dr-restore-test.log`.
- **rclone log:** `/var/log/ats-rclone.log`.
- **Queryable?** No Loki, no ELK, no Datadog. Just `ssh + tail/grep`. The runbook directly tells the operator `docker logs ats-backend --tail 50 2>&1 | grep -iE "cron-reauth..."` — that's the entire querying story.
- **Retention:** 7 days local for audit; "audit.log-*.gz" indefinitely in GDrive. Other logs (container, journald, bulk-rotate, morning-check, dr-restore-test) have **no rotation policy** — they grow until disk fills. journald has built-in caps, but the explicit `append:/var/log/ats/*.log` files do not.
- The bulk-rotate's `StandardOutput=append:` and morning-check `>> /var/log/ats/morning-check.log` will both grow without bound. No logrotate entry for them.

### E.7 Backup + DR

**rclone destination:** `ats-archive:ats-audit-archive/` on a Google Drive remote (OAuth via `rclone config`).

**Backed up nightly at 02:30 UTC** by `ats-archive.sh`:
1. Rotated audit logs `audit.log-*.gz` (5-min min-age guard against mid-rotation race)
2. SQLite snapshot via `sqlite3 .backup` (WAL-safe) → `db/ats.db`
3. Sealed tokens + `_alerts.json`/`_watchlist.json`/`_scanner.json` → `tokens/`
4. `ai_calls` rows older than 90 days exported to `.csv.gz` then **DELETED locally** (delete only on upload success)

**NOT backed up:** `/etc/ats/master.key` — deliberately, per `DR-RUNBOOK.md:42-45` ("would let anyone with GDrive access decrypt everything"). Sole copy lives on the operator's Windows box via `BACKUP-CREDENTIALS.cmd`. Also not backed up: `/etc/ats/backend.env` (same rationale presumably, but undocumented).

**Restore test:** `dr-restore-test.sh` exists. Scheduled monthly via `setup-dr-cron.sh`. Verifies: rclone pulls audit files, zcat works on latest, live DB schema/users/ai_calls readable from a fresh `.backup`, master.key ≥32 bytes. **Does NOT actually restore from GDrive snapshot** — the restore step is commented out. The "DR test" verifies that *if* something were restored, it would be readable; it does not verify the GDrive snapshot is itself usable. That's a meaningful gap given the RPO is 24 h.

**RTO/RPO:** documented `RTO < 1 h` and `RPO < 24 h` (`DR-RUNBOOK.md:13-15`). Last measured `rto_total_sec` in the example output is 35 s — but that's the test, not a full bare-metal rebuild. The real RTO including provisioning + DNS propagation + certbot + container start is realistically 60-120 min for a practiced operator.

### E.8 Auto-login daemon

**systemd unit:** `ats-auto-login-daemon.service` referenced in `setup-auto-login-daemon.sh:25` and `auto-login-daemon.js:12-15`. **The actual unit file is NOT in the repository** — `Glob deploy/scripts/systemd/*` returns only `ats-bulk-rotate.{service,timer}` and `INSTALL.md`. The setup script expects `$SCRIPT_DIR/ats-auto-login-daemon.service` to exist at install time. This is a **missing-artifact bug**: if you run `setup-auto-login-daemon.sh` from a fresh checkout, `install … ats-auto-login-daemon.service /etc/systemd/system/…` fails. The deployed VM presumably has a hand-written copy that was never committed.

**Health on the VM:** Operator-visible via `systemctl status ats-auto-login-daemon`. No Prometheus alert on its status. No health endpoint.

**TOTP rotation mid-day:** The daemon (`auto-login-daemon.js:44-59`) computes TOTP at request time from the seed in the per-user sealed credential. As long as the **seed** doesn't rotate, the daemon recomputes valid OTPs. Zerodha rotates the access_token daily at ~06:00 IST regardless; the multi-window cron handles that. If the user rotated the TOTP seed in Zerodha but didn't update it in ATS, the next reauth fails — and a stalled token means **the existing in-memory access_token continues to drive trading until the next tick of Kite's daily invalidation**. Trading **continues on the stale token** until either (a) reauth fails the user's `cron-reauth` retry chain (T-114: +15/+30/+60/+2h/+4h), (b) Kite returns 403 three times, T-58 detector flips `brokerWsStalled`, T-115 fires reactive reauth, OR (c) the user manually reauth's. Telegram fires "ATS auto-reauth retry chain exhausted".

Net: **trading halts when broker WS stalls**; trading **continues silently** through TOTP-seed mismatch until the daily Kite invalidation hits. The runbook covers this in Incident 1 + Incident 3.

### E.9 Staging environment

**Exists on paper** in `deploy/staging/`:
- `docker-compose.staging.yml` — runs container on `127.0.0.1:8081`, `BROKER=mock`, `KILL_SWITCH=true`, separate `/opt/ats/staging-data` volume.
- `nginx.conf` — minimal proxy block for `staging.ats.rajasekarselvam.com`.
- `SETUP.md` — 30-min install procedure.

**Status:**
- The deploy.yml workflow does **not** target staging. There is no `staging:` job. The "promote to staging first" pattern is described as a manual `SETUP.md` suggestion (operator changes the SSH target in deploy scripts). It is not wired.
- No DNS record `staging.ats.rajasekarselvam.com` is presumed extant — `SETUP.md` Step 1 tells the operator to add it manually.
- Parity gap: staging compose uses `restart: unless-stopped`, prod uses `restart: always`; staging omits the `read_only: true`, `cap_drop: ALL`, `security_opt: no-new-privileges`, `mem_limit`, `pids_limit`, master.key mount, `/etc/ats:ro` mount — staging is **materially less hardened** and would not catch container-permission regressions.
- Healthcheck differs (overrides Dockerfile's wget loop with another wget block; minor).

**Effective answer:** there is **no staging in production use**. Every commit-to-main lands on prod. Risk-mitigation today = the Playwright suite + the rollback path.

### E.10 nginx config quality

**TLS** (`rajasekarselvam.com.conf:60-71`): TLSv1.2 + TLSv1.3, `ssl_session_tickets off`, `ssl_prefer_server_ciphers off` (modern stance — defer to client). dhparams included. Lets Encrypt managed.

**Security headers** (`ats-security-headers.conf`):
- `Strict-Transport-Security max-age=15552000; includeSubDomains` — **180 days, not preload-eligible** (preload requires `max-age=31536000`). `rajasekarselvam.com.conf:74` uses `max-age=63072000` (2 yr) — inconsistent between the two configs.
- `X-Content-Type-Options nosniff` — good
- `X-Frame-Options DENY` — good (apex uses `SAMEORIGIN` — inconsistent)
- `Referrer-Policy strict-origin-when-cross-origin` — good
- `Permissions-Policy camera=(),microphone=(),geolocation=(),payment=()` — good
- `CSP`: `script-src 'self' 'unsafe-inline' 'unsafe-eval' https://unpkg.com https://cdnjs.cloudflare.com` — **`unsafe-inline` + `unsafe-eval` are both present**. Dockerfile already pre-transforms JSX with esbuild so `unsafe-eval` is presumably no longer needed; `unsafe-inline` could be replaced with nonces. The CSP comment in `rajasekarselvam.com.conf:78-79` explicitly admits this is permissive "while the prototype uses Babel Standalone and unpkg" — the comment is now stale post-esbuild.

**Proxy headers** (`ats.rajasekarselvam.com.conf:113-128`):
- `X-Real-IP $remote_addr`, `X-Forwarded-For $proxy_add_x_forwarded_for`, `X-Forwarded-Proto https` — correct.
- `X-ATS-Internal ""` — explicit strip of client-supplied internal-only header (line 126). Good defence-in-depth.

**Rate limits at the edge** (`ats.rajasekarselvam.com.conf:12-13`, `:111`, `:134`):
- `ats_api`: 30 r/s, burst 60, no delay.
- `ats_ws`: 10 r/s, burst 20.
- Zone size 10 m each (~160 k IPs each).
- **No `limit_conn`** (max concurrent connections per IP) — a single IP can hold thousands of WS connections.
- **No global rate limit** — only per-IP. A small botnet trivially bypasses.
- No `limit_req` on `/` (the static-file routes) — DoS via repeated `app.html` requests will hit the upstream eventually because nginx serves static here (acceptable).

**Other:**
- Static cache: 7d immutable on `.jsx/.css/.js/.png/...` — fine, but `.jsx` shouldn't be served at all post-esbuild transform; the regex would only match if the build broke. Vestigial.
- `robots.txt` returns Disallow: / always — good for pre-launch.
- Two config files have **duplicated `limit_req_zone` declarations** (both define `ats_api` and `ats_ws`) — fragile.

### E.11 Top 5 recommendations (impact × cost)

1. **Document + script master-key rotation.** No procedure exists. Today this means a key compromise is unrecoverable except by wipe-and-reonboard. Build `deploy/scripts/rotate-master-key.sh` that: (a) generates a new key, (b) iterates all sealed cells in `broker_accounts`, `users` AI-key columns, and `/var/lib/ats/tokens/*.enc`, (c) re-seals with the new key in a transaction, (d) atomically swaps `/etc/ats/master.key` only after re-seal succeeds. Add a section to `INCIDENT-RUNBOOK.md` with verification steps and a rollback path. File targets: new `deploy/scripts/rotate-master-key.sh`, edit `deploy/docs/INCIDENT-RUNBOOK.md`. **Impact: very high (compliance + actual incident recovery). Cost: medium (1-2 days).**

2. **Add a host-level metrics exporter and an Alertmanager watchdog.** Today no disk-full, OOM, restart-loop, or cert-expiry alert exists; `monitoring/README.md` does not deploy `node_exporter`/`cadvisor`. Add both as docker services on the same VM (~10 lines of compose), add scrape configs to `prometheus.yml`, add 4-5 rules to `rules.yml` (`DiskAlmostFull`, `HostHighMemory`, `ContainerRestartLooping`, `CertExpiringSoon`, `AlertmanagerDown`). Also wrap the telegram bridge in a systemd unit so it survives reboot (currently `nohup node`). File targets: edit `deploy/monitoring/prometheus.yml`, `deploy/monitoring/rules.yml`, add `deploy/monitoring/node-exporter.compose.yml`, add `deploy/monitoring/systemd/telegram-bridge.service`. **Impact: high (silent failures stop being silent). Cost: low (half-day).**

3. **Make `npm audit` blocking + add image scan.** `ci.yml:36` has `continue-on-error: true` on `npm audit`, with a TODO to flip it ("once the audit is clean"). Today high+critical CVEs ship silently. Flip `continue-on-error` to false, add an `--audit-level=critical` flag if noise is bad, then add a Trivy or Grype scan of the built image before push. Block on CVSS ≥ 9. File targets: edit `.github/workflows/ci.yml:34-46` and `.github/workflows/deploy.yml` (add scan step before `build-push-action`). **Impact: high (visible CVE posture). Cost: low (2-3 hours).**

4. **Wire a real staging deploy into CI, or delete the staging dir.** The `deploy/staging/` artefacts are aspirational, not active: `SETUP.md` is a manual one-off, deploy.yml has no staging job, and the staging compose is less hardened than prod. Either (a) add a `deploy-staging` job to `.github/workflows/deploy.yml` that runs on every push to a `staging` branch and on PR labels, then promotes to prod via `workflow_dispatch`; or (b) remove the staging dir to stop signalling that it exists. Option (a) is materially safer for risky changes (broker keys, DB migrations, nginx config). Bring staging compose to parity with prod (read_only, cap_drop, etc.). File targets: edit `.github/workflows/deploy.yml`, `deploy/staging/docker-compose.staging.yml`. **Impact: high (kills "tested in prod" risk). Cost: medium (1 day to wire + DNS + cert).**

5. **Pin a deeper rollback history + add a manual rollback script.** `deploy-on-vm.sh:53` keeps only N-1 in `.previous-tag`. Track last 5 successful SHAs in `/opt/ats/compose/.last-good-tags`, prune on size, and add `deploy/scripts/rollback-on-vm.sh <tag>` that the operator can invoke without remembering docker compose semantics. Also: add a post-deploy smoke test that hits 3 critical endpoints (`/api/me/ai-keys`, `/api/me/portfolio/holdings`, `/api/scanner/history`) before declaring success — not just `/api/health` which is too shallow. File targets: edit `deploy/scripts/deploy-on-vm.sh:53-94`, new `deploy/scripts/rollback-on-vm.sh`, edit `.github/workflows/deploy.yml:177-190` (deeper post-deploy probe). **Impact: medium-high (faster + safer recovery). Cost: low (3-4 hours).**

---

**Cross-references for the section editor:**
- The systemd unit file `ats-auto-login-daemon.service` is referenced in `deploy/scripts/setup-auto-login-daemon.sh:25` and `deploy/scripts/auto-login-daemon.js:13-15` but is **NOT in the repo** under `deploy/scripts/systemd/`. The install will fail from a clean checkout. Flag to the tests/tech-debt section as well.
- The deploy comment in `deploy.yml:75` ("Build & push (linux/amd64)") is incorrect — the `platforms:` line below says `linux/arm64`. Cosmetic, but misleading for future operators.
- `setup-rclone-archive.sh:50-82` defines a wrapper, and `ats-archive.sh` is a separate file with overlapping functionality (more thorough). The two scripts coexist; the cron entry written by `setup-rclone-archive.sh` points at `/usr/local/bin/ats-archive-audit.sh` which is documented as a symlink to `/opt/ats/scripts/ats-archive.sh`. Layering is confusing — worth a tech-debt pass.

## F. Technical debt + roadmap

**Last updated:** 2026-05-19 (T-194 comprehensive audit, debt-and-roadmap section)
**Scope:** synthesis only — does NOT re-derive findings from `SCREENS-AUDIT.md` (F-1..F-16), `SECRETS-AUDIT.md`, `TESTING-PLAN.md` §3, or the backend/security/deploy sections of this same doc. Citations link back to those sources.
**Reference:** HEAD `34d63da` (T-175), 47,789 LoC across 56 backend `.js` + 56 frontend `.jsx`.

---

### F.1 Tech-debt inventory (aggregated)

Six categories, sourced from the other audit sections — do NOT treat this list as new findings, treat it as the deduplicated index.

#### (a) God-class / size-bloat
| File | LoC | Smell | Source |
|---|---:|---|---|
| `deploy/backend/server.js` | 5,279 | 175 route definitions in one file, 9 `app.use('/api…')` mount points scattered between L1017–L3840, 46 raw `console.*` calls. Every other backend module has been factored out (account-routes.js, ai-keys-routes.js, me-broker.js, etc.) — server.js is what's left after the easy extractions. | self-measured |
| `deploy/backend/ai-workflows-routes.js` | 1,096 | Sibling god-route file; mixes critique-rich, consensus, monthly-review, vision, replay, experiments under one router. | self-measured |
| `src/screen-dashboard.jsx` | 1,186 | 15 top-level `useState` + 20 API calls + nested BulkDealsTile/FiiDiiTile state — `SCREENS-AUDIT §2.2`. |
| `src/screen-ai-keys.jsx` | 1,099 | 23 useState — "largest in the codebase" — flagged as `F-13` in `SCREENS-AUDIT §4`. |
| `src/screen-paper.jsx` | 883 | 15+ useState, 7 fetch sites but only 5 `.catch` handlers (`F-10`). |
| `src/screen-brokers.jsx` | 787 | 23 useState; owns the raw-credential entry surface (`SCREENS-AUDIT §2.8`). |

#### (b) Missing tests
- **Playwright route coverage: 32/57 routes covered, 25 with zero assertions** — `SCREENS-AUDIT §5.2`. Highest-risk gaps: `#harvest`, `#money`, `#compliance`, full `#login → #verify → #reset` chain.
- **Frontend has zero unit/component tests.** 56 `.jsx` files are protected only by a smoke spec that asserts "page renders without console errors" — `TESTING-PLAN §3 P0 #3` (deferred).
- **Backend unit tests: 49 spec files / 371 assertions** — solid coverage of helpers but no tests for `server.js` route handlers as a unit (only via Playwright against live).
- **No load test of WS tick fan-out**, no chaos test (kill broker WS mid-tick), no synthetic transaction monitor — `TESTING-PLAN §3 P1/P2`.
- **No staging gate before prod** — every push to `main` deploys straight to live — `TESTING-PLAN §3 P1`.

#### (c) Inconsistent naming / API sprawl
- **Frontend r8/r9/r10/r11 grab-bag files** — `r8-primitives.jsx`, `r8-ai-assistant.jsx`, `r9-additions.jsx` (721 LoC), `r10-additions.jsx`, `r11-additions.jsx` (625 LoC). Tier-suffix naming conveys "stuff we shipped in release N" instead of what the file is for. New devs cannot find toasts, banners, ErrorBoundary, formatINR, etc., without grepping.
- **`/api/me/*` vs `/api/v1/me/*` split.** `/api/v1/me/*` mounts (server.js:3819, 3840) cover account/preferences/notifications/brokers (the newer surface). `/api/me/*` covers everything else (signals, paper, pnl, dashboard-summary, autorun, watchlist). Same screen often hits both (`screen-ai-keys.jsx` mixes them — `SCREENS-AUDIT §4 F-11`). No documented migration plan.
- **Stale routes still referenced by Playwright:** `#benchmark`, `#news`, `#regime` — removed in `app.jsx` (T100/v9 reduction) but smoke spec still navigates to them (`SCREENS-AUDIT §5`).
- **One leftover `.prod-snapshot` file** — `src/screen-ai-keys.jsx.prod-snapshot`. Either re-add to `.gitignore` or delete.

#### (d) Deferred safety / CSRF / observability fixes
- **CSRF surface** — every mutating fetch uses `credentials:'include'` without a CSRF token (`SCREENS-AUDIT F-14`). T-181 added Origin/Referer check (verified by live probe `SECRETS-AUDIT §4 probe 6a/7`) but no token-based defense-in-depth.
- **`alert("Paused all modes — placeholder")`** in `src/app.jsx:155` — command palette advertises an action that doesn't work (`F-6`).
- **`screen-trading.jsx` order-form will go live the instant kill switch flips** — buttons render but `POST /api/orders/place` is not wired today. No explicit `disabled={killSwitch}` (`F-9`).
- **`screen-money.jsx` `/api/sweep/execute` lacks UI 2FA gate** while real-order placement does have one (`F-16`).
- **Pattern: `try {…} catch {}`** swallows fetch failures silently across paper/audit/recon/harvest (`F-8`).
- **Stale demo data renders unconditionally** — circuits dashboard hardcoded `current:` values (`F-1`), harvest lots (`F-2`), trading chart candles from `seriesRandom()` (`F-4`), factor-tilt demo universe seeds form (`F-5`).
- **`continue-on-error: true` on Playwright** was the gap until T-175 promoted it to blocking. Recent.

#### (e) Operational SPOFs
- **Single-VM deployment** — Oracle Cloud Ampere A1 at 141.148.192.4. No failover. RTO target <1h, RPO <24h (`DR-RUNBOOK.md`). DR rehearsal not on a verified timer (`TESTING-PLAN §3 P1`).
- **Single-operator model, no on-call rota** — `DR-RUNBOOK §142`: *"Not in place yet — single user, no SLOs."*
- **libsodium `master.key` lives on the VM filesystem** at `/etc/ats/master.key` (root-readable, chmod 400). Loss = total per-user vault loss (Zerodha tokens, AI BYOK keys, Telegram bot tokens, sealed login vault all unrecoverable). `TESTING-PLAN §6.4` raises moving to OCI Vault as an open question.
- **24 `DEPLOY-*.cmd` files at repo root** (69 `.cmd` total) — operator-side deploy choreography is shell-script-driven, not declarative. Replaceable by 1-2 idempotent scripts.

#### (f) Feature-gaps surfaced by audits
- **Per-mode runtime aggregation backend** — `screen-modes.jsx:53-58` shows zeros until `/api/me/modes/runtime` ships (`F-7`).
- **Real `/api/system/info → riskCaps` wired through to circuit-breaker dashboard** (`F-1` fix).
- **`/api/paper/fill-quality` endpoint** for Paper screen Fill-quality card (`F-3`).
- **Candle endpoint** to replace `seriesRandom()` chart data (`F-4`).
- **Multi-broker contract tests** — `broker-resolver.js:75` notes `// TODO: dhan, angelone, upstox -- adapters exist server-side; wire them when needed`. Adapters exist (`brokers/dhan-broker.js`, `angelone-broker.js`, `upstox-broker.js`) but only zerodha is wired through `broker-resolver`. `upstox-broker.js:61` throws `not implemented` for `getHistorical`.

---

### F.2 TODO / FIXME / HACK scan

Total tagged comments across `deploy/backend/**.js` and `src/**.jsx`: **8** (excluding string-literal placeholder text like `XXXX`).

| File:line | Tag | Comment | Age (commit) |
|---|---|---|---|
| `deploy/backend/broker-resolver.js:75` | TODO | `dhan, angelone, upstox -- adapters exist server-side; wire them when needed` | Tier 57+58 (`cdf1310`) — longest-standing |
| `deploy/backend/brokers/upstox-broker.js:13` | TODO | `Their tick stream is via WebSocket; here we leave it as a TODO marker.` | Tier 57+58 |
| `deploy/backend/brokers/upstox-broker.js:61` | (throw) | `'upstox: getHistorical not implemented yet. See … TODO.'` | Tier 57+58 |
| `deploy/backend/server.js:2690` | TODO | `when CAS-upload persistence lands, query a per-user mf_holdings table here.` | post-T-99 |
| `deploy/backend/test/alerts.test.js:83` | HACK | (variable name `'HACKED'` — test fixture, not real debt) | T-152 |
| `deploy/backend/ai-workflows-routes.js:851` | (XXXX) | `data:image/png;base64,XXXX` — error-message format string | n/a |
| `deploy/backend/cas-parser.js:68` | (XXXX) | `Folio No: XXXX` — comment formatting | n/a |
| `src/r11-additions.jsx:11` | (XXX) | `Replaces ad-hoc ₹X / ₹XL / ₹X,XX,XXX inline math` — descriptive | n/a |

**Real-debt items: 4** (the three multi-broker TODOs all describe the same gap; CAS table TODO is the only standalone item). The TODO/FIXME inventory is *suspiciously clean* — debt has been moved into audit docs (`SCREENS-AUDIT.md` F-1..F-16, this doc, `TESTING-PLAN.md` P0/P1/P2 tables) rather than left as inline comments. Healthy for searchability but means inline scans understate the real backlog.

**Longest-standing item:** the multi-broker wiring TODO in `broker-resolver.js:75`, dating back to Tier 57+58 (commit `cdf1310`, pre-T-99). All other broker code has since shipped; the resolver gate is what's left.

---

### F.3 Velocity + theme analysis (last ~50 commits)

Most recent 50 commits span T-129 (Tier 78 e2e Playwright spec) → T-175 (Playwright BLOCKING in CI), roughly 2026-04 → 2026-05-19.

**Theme distribution (by commit subject):**
- **Test hardening (T-141..T-155, T-169, T-171..T-175):** 20+ commits adding unit tests for sessions, login-vault, crypto-vault, market-meta, sector-map, earnings-calendar, alerts, surveillance, notify, ai-router, bulk-rotate helpers; plus the Playwright stale-spec fix-up and the promotion to blocking. **40% of recent velocity.**
- **Honest-data sweep (T-134..T-139, plus the older T-80..T-105 chain):** removing hardcoded KPIs / fake numbers from Backtest, AI Review, Portfolio, Trading Modes, Profile, etc. Tied to `MockData.isDemoOn()` gating. **20%.**
- **Multi-tenant / safety (T-130..T-133, T-138, T-181):** WS auth-on-connect + per-WS watchlist filtering, internal bulk-rotate routes, Origin/Referer CSRF gate. **15%.**
- **Foundation backend endpoints (T-156..T-159, T-162..T-163):** monthly PnL aggregation, sweep ledger MTD, promotion-rate proxy, scanner G-series plugins. **10%.**
- **Operational polish (T-160, T-161, T-164..T-168, T-170):** SMTP wiring, SPF/DKIM/DMARC docs, account migration cleanup, CI hygiene, deploy fixes. **15%.**

**Maturity stage:** **stabilizing, on the cusp of "ready to scale."** Not churning — the commit messages tell a coherent story, audit docs are growing rather than shrinking the backlog. Not yet "scaling" because the core multi-tenant pieces (per-mode runtime backend, multi-broker wiring, frontend tests) are still open. The system is finishing its "second pass" — closing the gaps the first pass deferred, before opening new fronts.

**Tell-tale signs of stabilization, not churn:**
- Strict-mode tests in CI flipped on (T-150 capstone).
- Playwright promoted to blocking (T-175).
- Live probe results (`SECRETS-AUDIT §4`) 8/8 pass.
- Honest-data banners + `isDemoOn()` gating across 20+ screens — code knows the difference between real and demo.
- Auto-recovery is real: broker WS stall self-heals in <15min via T-114/T-115/T-116.

---

### F.4 Risk-weighted backlog — top 15 (impact × likelihood ÷ effort)

Scoring rubric:
- **Impact** 1–5: blast radius if it happens (5 = real-money loss / regulatory expoure / total data loss).
- **Likelihood** 1–5: probability of triggering in next 90 days at current usage.
- **Effort** 1–5: engineering days (1 = ≤1 day, 5 = ≥4 weeks).
- **Priority** = (Impact × Likelihood) / Effort.

| # | Item | Source | I | L | E | Score |
|---|---|---|---:|---:|---:|---:|
| 1 | Sweep-execute money move has no UI 2FA gate (will fire MF/ETF buys when wired) | `SCREENS-AUDIT F-16` | 5 | 4 | 1 | 20.0 |
| 2 | Hardcoded harvest lots render as real tax-loss opportunities | `SCREENS-AUDIT F-2` (`screen-harvest.jsx:22-30`) | 5 | 3 | 1 | 15.0 |
| 3 | Trading order form goes live the instant kill switch flips, no `disabled` guard | `SCREENS-AUDIT F-9` | 5 | 3 | 1 | 15.0 |
| 4 | CSRF token defense-in-depth (Origin check exists but is one fence) | `SCREENS-AUDIT F-14`, `SECRETS-AUDIT §4 probe 6/7` | 4 | 3 | 2 | 6.0 |
| 5 | Circuit-breaker dashboard shows fake `current:` values during incidents | `SCREENS-AUDIT F-1` | 4 | 3 | 2 | 6.0 |
| 6 | server.js 5,279 LoC blocks safe extension of order/risk paths | self §F.1(a) | 4 | 4 | 3 | 5.3 |
| 7 | `master.key` on VM filesystem — single point of total vault loss | `TESTING-PLAN §6.4`, §F.1(e) | 5 | 1 | 2 | 2.5 |
| 8 | 25 screens with zero Playwright assertions (money/compliance/auth chain) | `SCREENS-AUDIT §5.2` | 4 | 4 | 4 | 4.0 |
| 9 | Trading ChartCard candles are `seriesRandom()` — fake trend visible | `SCREENS-AUDIT F-4` | 3 | 4 | 2 | 6.0 |
| 10 | `try{}catch{}` swallows fetch errors across paper/audit/recon/harvest | `SCREENS-AUDIT F-8` | 3 | 4 | 2 | 6.0 |
| 11 | Frontend has zero unit/component tests | `TESTING-PLAN §3 P0 #3` (deferred) | 3 | 4 | 3 | 4.0 |
| 12 | `screen-ai-keys.jsx` is a 23-useState god component | `SCREENS-AUDIT F-13` | 2 | 4 | 3 | 2.7 |
| 13 | Multi-broker resolver TODO (`broker-resolver.js:75`) blocks dhan/angelone/upstox | §F.2 | 3 | 2 | 3 | 2.0 |
| 14 | No staging gate before prod (push-to-main = push-to-prod) | `TESTING-PLAN §3 P1` | 4 | 2 | 3 | 2.7 |
| 15 | `/api/me/*` vs `/api/v1/me/*` split with no documented migration plan | §F.1(c) | 2 | 3 | 3 | 2.0 |

**Top 3 are all single-day fixes with money-loss blast radius — ship before any new feature.**

---

### F.5 Ranked roadmap — next 90 days

#### Month 1 — Foundational (May 19 → Jun 18)

Goal: unblock everything else. None of these add user-visible features; all of them remove a hazard that the next two months would otherwise re-create.

| # | Item | Scope | Deliverable | Success metric |
|---|---|---|---|---|
| M1.1 | **Wire 2FA gate on `/api/sweep/execute`** (backlog #1) | Route the existing `Confirm2FA` modal (modals.jsx) into the sweep-execute click in `screen-money.jsx`; mirror the `POST /api/orders/place` flow. | 1 PR, modified `screen-money.jsx` + 1 Playwright spec under `#money`. | `npx playwright test money-sweep-2fa` passes; manual confirm modal fires. |
| M1.2 | **Disable trading order buttons when kill switch on** (backlog #3) | `screen-trading.jsx` reads `window.atsBrokerStatus` + `/api/system/info.killSwitch`; OrderForm buttons get `disabled={true}` + tooltip. | 1 PR, modified `screen-trading.jsx`. | Visual check + Playwright assertion `expect(btn).toBeDisabled()` while killSwitch=true. |
| M1.3 | **Gate `screen-harvest.jsx` hardcoded lots behind `MockData.isDemoOn()`** (backlog #2) | Prefer `liveHarvest.lots` when present; render the 7-row fake array only in demo. | 1 PR, modified `screen-harvest.jsx:22-30` and the render path. | Live URL shows empty state when no live harvest data; demo mode still shows the 7 rows. |
| M1.4 | **Split `server.js` into 4–5 route modules** (backlog #6) | Extract: `routes/admin.js` (lines 437–597, 897–1083), `routes/paper.js` (1889–~2200), `routes/market.js` (1322–1843), `routes/orders.js` (the live-order surface). Keep `server.js` <2000 LoC. | 1 large PR; CI green; no behavior change. Add a regression test that asserts `wc -l server.js < 2000`. | Playwright suite green; new route file LoC <800 each; `node --check` clean. |
| M1.5 | **Delete or re-gitignore `src/screen-ai-keys.jsx.prod-snapshot`** | Trivial cleanup; the existence of `.prod-snapshot` files in a tracked tree is a smell. | 1 commit. | `git ls-files | grep prod-snapshot` returns nothing. |

#### Month 2 — Safety / observability (Jun 18 → Jul 18)

Goal: harden the things M1 just made safer to touch.

| # | Item | Scope | Deliverable | Success metric |
|---|---|---|---|---|
| M2.1 | **CSRF token defense-in-depth** (backlog #4) | Add `X-CSRF-Token` header (read from `meta` tag or session cookie) on all `/api/v1/*` mutating routes. Backend rejects mismatches with `403 csrf_failed`. | Backend middleware + frontend wrapper in `r8-primitives.jsx` fetch helper. | Live probe: same-origin POST without token → 403; with token → expected response. |
| M2.2 | **Wire circuit-breaker dashboard to `/api/system/info → riskCaps`** (backlog #5) | Replace hardcoded `current:` values in `screen-circuits.jsx:11-28` with live values; mirror `LiveRiskCards` pattern from `screen-risk.jsx`. | 1 PR, modified `screen-circuits.jsx`; Playwright spec covers the new field. | Manual: change a riskCap on VM → reflected in `#circuits` within 5s. |
| M2.3 | **Frontend Vitest scaffold + 5 high-risk component tests** (backlog #11; deferred from `TESTING-PLAN P0 #3`) | jsdom env, `@babel/preset-react` loader, strategy for `window.*` exports. First 5 tests: KillSwitchButton (shell.jsx), Confirm2FA modal (modals.jsx), `useModeState` (trading-modes.jsx), DemoBanner (r11-additions.jsx), formatINR. | Vitest config + 5 specs + CI step. | `npm run test:unit` runs in <30s; CI step green. |
| M2.4 | **Error-state surfacing on silent catches** (backlog #10) | Replace `try{…}catch{}` with `try{…}catch(e){ setErr(e) }` + render a small "data unavailable" pill across paper/audit/recon/harvest. | Pattern-based PR across 4 screens. | Inject a fetch error in Chrome devtools → pill appears; no console error eaten. |
| M2.5 | **Scheduled live health check workflow** (`TESTING-PLAN P1`) | GitHub Actions cron every 15 min during market hours; hits `/api/health` + `/api/health-deep`; email on non-200. | `.github/workflows/health-monitor.yml`. | First non-200 within market hours alerts within 30 min. |

#### Month 3 — Scale / UX (Jul 18 → Aug 18)

Goal: enable the next 10 users, the next broker, the next feature without re-doing M1/M2.

| # | Item | Scope | Deliverable | Success metric |
|---|---|---|---|---|
| M3.1 | **Wire `broker-resolver.js` for dhan + angelone** (backlog #13) | Extend `broker-resolver.js:75` to `case 'dhan'`/`'angelone'` (adapters already exist). Add `account-routes.js` PUT handlers for each. Add `test/broker-resolver.test.js` cases. | 1 PR + 6 new tests. | A test user can connect dhan creds via #brokers and place a paper order. |
| M3.2 | **Per-mode runtime backend endpoint** (`SCREENS-AUDIT F-7`) | Ship `/api/me/modes/runtime` returning per-mode open positions / utilized / today PnL / strategies running. Replace RUNTIME zeros in `screen-modes.jsx:53-58`. | 1 PR backend + 1 PR frontend + Playwright spec. | `#modes` shows real numbers; no demo-mode banner needed for those tiles. |
| M3.3 | **Staging gate before prod** (`TESTING-PLAN P1`, backlog #14) | Wire `staging/docker-compose.staging.yml` into the deploy workflow; run Playwright suite against staging before promoting to prod. | Updated `deploy.yml`. | One failing staging run → no prod deploy that day. |
| M3.4 | **Refactor `screen-ai-keys.jsx` into KeyVault / RouterPanel / ExperimentsPanel / UsagePanel** (backlog #12) | Split the 23-useState god into 4 components; rendered children re-render independently. | 1 PR, no behavior change. | LoC of `screen-ai-keys.jsx` <500; each sub-component <300. |
| M3.5 | **Document `/api/me/*` vs `/api/v1/me/*` plan; consolidate on `/api/v1/*`** (backlog #15) | Either: (a) deprecate `/api/me/*` in favor of `/api/v1/me/*`, OR (b) keep both with documented rationale per endpoint. Update `SCREENS-AUDIT §2` and INDEX. | 1 markdown PR + redirect handlers if (a). | `grep -c "/api/me/" src/*.jsx` decreases (if a) OR doc reconciles (if b). |

---

### F.6 What NOT to do (right now)

- **Don't switch to a build system (webpack/vite/esbuild).** The in-browser Babel transform is unusual but stable, no user-visible bug ties to it, and a build step would block hot-fix deploys via SSH. Reconsider when the codebase grows past ~80 `.jsx` files OR a TypeScript migration is on the table.
- **Don't break server.js into microservices.** A single Node process owns broker WS, paper engine, audit log, scheduler, REST. Splitting now adds inter-process auth, deployment complexity, and a 5-minute deploy becomes 25 minutes — for a single-tenant system. Re-evaluate at 100 paying users.
- **Don't rewrite the in-house libsodium SealedBox vault to use OCI Vault yet.** It's flagged as a real concern (`TESTING-PLAN §6.4`) but the migration is multi-week, the current key file is `chmod 400 root`, and `dr-restore-test.sh` covers most of the realistic loss modes. Schedule for Q3 alongside multi-region planning.
- **Don't promote Playwright to a deploy-gate-with-no-flake-budget.** It just became blocking in T-175; let it run for ~2 weeks and triage flakes before adding more strict gates on top.
- **Don't migrate `/api/me/*` to `/api/v1/me/*` in a single sweep.** Both surfaces work; the migration belongs after M3.5 has documented the plan. A premature flip breaks every screen that loads the old paths.
- **Don't ship per-user billing or SaaS-multi-tenant UI yet.** The infrastructure (per-user vault, BYOK AI keys, per-WS tick filter) is ready, but `DR-RUNBOOK §142` is explicit: *"Not in place yet — single user, no SLOs."* Adding billing before SLOs is a regulatory + ops trap.

---

### F.7 Maturity scorecard

| Dimension | Score (1–5) | Justification |
|---|---:|---|
| Code quality | **3** | server.js bloat (5,279 LoC) and 5 god-components offset by clean module factoring elsewhere, 49 backend test files, only 8 inline TODO/FIXMEs because debt has moved to audit docs. |
| Test coverage | **3** | 371/371 backend unit tests strict in CI (T-150); Playwright blocking (T-175); but 25/57 routes uncovered and zero frontend component tests. |
| Security | **4** | Per-user libsodium vault, Origin/Referer CSRF gate live-probed at 8/8 pass (`SECRETS-AUDIT §4`), no real secrets in tracked source, kill-switch + `liveTrading:false` defense-in-depth; loses 1 point for no CSRF token + master.key SPOF. |
| Observability | **4** | `/api/health-deep` with 9 surfaced signals, `x-request-id` propagation (T-78/T-79), `/api/admin/observability` admin endpoint, ticker-stall self-healing within 15min, audit hash-chain integrity check; loses 1 point for no scheduled live-health monitor. |
| Deployability | **3** | GitHub Actions → GHCR → SSH → systemd works and includes a 30s post-deploy smoke; loses 2 points for no staging gate, 24 `DEPLOY-*.cmd` operator-side files showing the rough edges, single-VM SPOF. |
| Documentation | **4** | 7 dedicated audit/runbook docs in `deploy/docs/`, `INDEX.md` covers every doc, `INCIDENT-RUNBOOK.md` has 8 failure modes with diagnostic steps, `DR-RUNBOOK.md` lists RTO/RPO; loses 1 point because operator-only `.cmd` files lack inline `why this exists`. |

**Average: 3.5 / 5** — a mid-stage system with strong fundamentals (security, observability, docs) and clear, surfaced weaknesses (code quality, deployability). The fact that the weak areas are *documented and ranked* — not hidden — is itself a maturity signal worth half a point that the rubric can't capture.

---

### F.8 Net read

ATS is a single-operator algo-trading platform that has spent the last ~50 commits stabilizing rather than building new features — closing the "honest-data" gap, hardening tests (T-150 strict, T-175 Playwright blocking), and finishing the per-user multi-tenant foundation (T-130..T-133 WS auth + bulk-rotate). The credential architecture is clean (`SECRETS-AUDIT` verdict: CLEAN, 8/8 live probes pass), the audit doc hygiene is unusually good for a one-person codebase, and the system self-heals from the broker-WS failure that would otherwise be the most common outage. The remaining debt is concentrated in three places: `server.js` is the last unfactored module at 5,279 LoC, 25/57 screens have no Playwright coverage, and the frontend "honest-data" sweep has surfaced ~6 hardcoded-data findings (`F-1..F-7`) that are individually one-day fixes but collectively decide whether a user can trust what they see. The 90-day roadmap should burn down the three single-day money-blast-radius items (#1 sweep 2FA, #2 harvest lots, #3 trading buttons) in week 1, then use the cleared decks to split `server.js`, scaffold frontend tests, and wire the second broker. The system is closer to "ready to scale" than the LoC count suggests — what it needs is not more features, but two more passes of the same discipline already on display in the audit docs.

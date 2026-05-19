# Session Summary — 2026-05-19

**Range:** `cdaca7f` → `935230604` (38 commits, T-188 → T-228)
**Operator:** rajasekarjavaee@gmail.com
**Audit coverage shipped:** all M1.x (foundational), nearly all M2.x (safety/observability), partial M3.x (scale/UX)
**Production endpoint:** https://ats.rajasekarselvam.com (all changes live)

Supersedes the earlier T-212 close-out. This version captures the M1.4 server.js split (10 additional commits) and the T-228 P0 auth fix discovered mid-flight.

---

## What's new vs. the T-212 version of this doc

- M1.4 `server.js` split — fully complete across 10 sub-commits (T-214 → T-227)
- Two operational lessons surfaced during the split: see *Lessons learned* below
- One P0 incident discovered + fixed: `/api/auth/*` was returning `auth_not_initialized` for 2 days due to a destructure-by-value capture before `init()` ran (T-228)

---

## M1.4 — `server.js` god-class split

`server.js` shrank from **5,553** lines pre-M1.4 to **4,729** lines post-M1.4 (-824 net, -15%).

| Piece | Commit(s) | Module created | Lines pulled |
|---|---|---|---|
| 1. strategies registry | T-214 / T-214a | `routes/strategies.js` | ~225 |
| 2. auth routes | T-216 / T-228 | `routes/auth.js` | ~150 |
| 3. OAuth state signer | T-217 | `services/oauth-state.js` | ~60 |
| 4. portfolio routes | T-218 | `routes/portfolio.js` | ~120 |
| 5a. order validation Sets | T-219 | `services/order-validation.js` | ~40 |
| 5b. order rate-limit helpers | T-220 | `services/order-rate-limit.js` | ~40 |
| 6a. `/api/orders/dry-run` | T-223 / T-223a | `routes/orders.js` (stub) | ~9 |
| 6b. order place/cancel/2fa | T-224 / T-224a | `routes/orders.js` (full) | ~261 |
| 7a. broker tick fan-out + upstream broadcaster | T-226 | `services/tick-fanout.js` | ~68 |
| 7b. WSS ctor + connection handler | T-227 | `routes/ws.js` | ~177 |

After all 7 pieces: `routes/orders.js` is the only deps-heavy module (19 deps: env caps, validation Sets, rate-limit helpers, 3 mutable singletons via getters, plus 3 hoisted function declarations). All other route/service modules are 1–7 deps.

### Why getter functions for some deps and direct values for others

`server.js` declares its services with `let broker, paper, twoFactor, alerts, db, watchlist, auth, emailAlerts, ...;` at module-level (L139). Those bindings only get **values** when the bottom-of-file IIFE runs `await init()` (L4929+). All top-level `mountXxx(app, deps)` calls execute BEFORE the IIFE — by `await` time, the captured deps are already frozen at whatever value they had when the object literal was evaluated.

- **Constants** (`KILL_SWITCH`, `MAX_*`, `VALID_*` Sets, `CSRF_ALLOWED_ORIGINS`) — assigned at module load. Safe to pass by value.
- **Function declarations** (`audit`, `withAuth`, `pickBroker`, `readSessionCookie`, `resolveUserBroker`) — hoisted, available at module load. Safe to pass by value.
- **`let` singletons populated in `init()`** (`broker`, `paper`, `twoFactor`, `auth`, `emailAlerts`, `alerts`, `db`, `watchlist`) — UNDEFINED at top-level mount time. **MUST pass as getter closures** `() => broker`. Handlers call the getter at request time.

This pattern was unknown until T-228 surfaced. Pieces 6b/7a/7b all use it; T-228 retrofitted it onto T-216 (auth).

---

## T-228 — P0 incident: `/api/auth/*` broken for 2 days

**Symptom (discovered during 6b planning):** prod `curl POST /api/auth/login` returned `{"ok":false,"reason":"auth_not_initialized"}` for all 5 routes that consult `auth.*`: login, signup, forgot-password, verify-email, reset-password.

**Root cause:** T-216 (M1.4 piece 2, 2 days prior) extracted `mountAuthRoutes(app, { auth, emailAlerts })`. The mount call ran at top-level L4048, but `auth = createAuth(...)` only happens inside `init()` at L5200. The object literal `{ auth, emailAlerts }` was evaluated when `auth` was still `undefined`. The destructure inside `mountAuthRoutes` captured `undefined` permanently. Every subsequent request saw `if (!auth) return 503 auth_not_initialized`.

**Why it took 2 days to notice:** existing session cookies kept working because `/api/auth/me` only consults `req.user` (set by upstream middleware), not the captured `auth`. Operator stayed logged in. The break only manifests for un-cookie'd users (new logins, signups, password resets).

**Why other M1.4 extracts didn't hit it:** `routes/portfolio.js` takes `resolveUserBroker` (a function declaration — hoisted, always defined). `routes/strategies.js` takes no deps. `services/oauth-state.js` is pure. Only `routes/auth.js` happened to need a `let` singleton.

**Fix (df9c79be):** changed mount to `{ getAuth: () => auth, getEmailAlerts: () => emailAlerts }`. Handlers call `getAuth()` at request time, getting the populated value.

**Same trap blocks pieces 6b/7a/7b.** Those use `broker`/`paper`/`twoFactor`/`db`/`watchlist` — all `let` singletons. The fix was to use getters uniformly from the start.

---

## Other lessons from this session

### Bug class: curl `-d "$BIG_BASE64"` exceeds ARG_MAX silently

While pushing T-223 via the GitHub Git Database API, curl's command-line arg list overflowed for the 5,235-line `server.js` base64 blob. Linux ARG_MAX is typically 128KB; the base64 blob was ~330KB. curl logged `Argument list too long` to stderr but exit code stayed in the chain, so the blob-upload returned an empty SHA. The new-tree API accepted the empty-SHA entry by silently **omitting** server.js from the tree. CI then failed at Docker build (no file to COPY).

Fixed via `T-223a` rollback-forward + standardized blob uploads on `curl --data-binary @file` for all subsequent pushes (T-223a, T-224, T-224a, T-226, T-227, T-228).

### Bug class: tests written against a moved handler still source-grep `server.js`

`broker-gateway-safety.test.js` (Layer 3 + Layer 4) and `order-guards.test.js` both pin invariants by reading `server.js` and searching for handler code. When 6b moved the place/cancel/2fa handlers to `routes/orders.js`, the Layer-4 tests still scanned `server.js` and reported "place not auth-gated" because the file no longer contained the line.

The same-commit test update is documented in the M1.4 hand-off doc and is required for every future extract that involves a source-grep test.

---

## Production smoke tests at session close

| Endpoint | Expected | Actual |
|---|---|---|
| `GET /api/health` | `ok=true`, `broker.connected=true`, `subscribers=1`, `tickStale=false` | ✅ matches |
| `POST /api/orders/dry-run` | `503 KILL_SWITCH_ON` (prod has `KILL_SWITCH=true`) | ✅ matches |
| `POST /api/orders/place` (no auth) | `401 auth_required` | ✅ matches |
| `POST /api/orders/cancel` (no auth) | `401 auth_required` | ✅ matches |
| `POST /api/orders/confirm-2fa/badtoken` | `404 unknown_or_used` (T-227 getTwoFactor() works) | ✅ matches |
| `POST /api/auth/login` (bad creds) | `401 invalid credentials` (T-228 fix) | ✅ matches |
| `POST /api/auth/forgot-password` | `200 {sent: false}` | ✅ matches |

Production has been on `935230604` (T-227 7b) since 15:13 UTC. Six successful deploy cycles this session (T-217, T-218, T-219+T-220, T-221, T-223+T-223a, T-224+T-224a, T-226, T-227 + the T-228 hotfix).

---

## Open / deferred work

| Area | Status | Notes |
|---|---|---|
| M3.1 — multi-broker dhan/angelone wiring in `broker-resolver.js` | NOT shipped | Adapters exist (`dhan-broker.js`, `upstox-broker.js`, `angelone-broker.js`). Resolver still has `// TODO: dhan, angelone, upstox` at L75. Worth ~1-2h focused work. |
| M2.1 — CSRF token HARD-fail phase | NOT shipped | T-205 shipped the soft-fail (audit-only) phase. Promotion to hard-fail (`403 csrf_failed`) needs a frontend pre-flight first. |
| M3.3 — Staging CI gate | partial | T-212 brought the staging compose to security parity with prod. The CI workflow step (`deploy-staging` job in `.github/workflows/deploy.yml`) is documented but not wired (operator-side, needs DNS + cert first). |
| Junk test user `id=9 / u1779201286@test.example` | manual | Created during T-228 verification via `/api/auth/signup`. Delete via `DELETE FROM users WHERE id=9` on the VM's `/opt/ats/tokens/users.db`. |
| Local working tree sync | manual | Local was at T-175 (`34d63da`) for most of this session. All commits this session were pushed via Git Database API. After session close, run `SYNC-FROM-GITHUB.cmd` to bring the local tree to `935230604`. |

---

## Boot order (post-M1.4) — for future extracts

The new `server.js` top-level execution order (line numbers approximate):

```
L1-L120     require imports + env-derived constants
L122-L132   function audit(...)         (hoisted, ready immediately)
L139        let broker, paper, twoFactor, alerts, db, ... = undefined
L290+       async function init() { ... assigns the let singletons ... }
L410        function readSessionCookie(...)
L1099       const CSRF_ALLOWED_ORIGINS = new Set([...])
L1404+      Prometheus /metrics gauge: iterates wsClients
L1461       Alerts broadcaster: iterates wsClients
L1783       mountStrategiesRoutes(app)                                  (T-214)
L2587       async function pickBroker(req) {...}
L2621       mountPortfolioRoutes(app, { resolveUserBroker })            (T-218)
L3177       function withAuth(handler) {...}
L4048       mountAuthRoutes(app, { getAuth: () => auth, ... })          (T-216 + T-228)
L4279       mountOrdersRoutes(app, { ... 19 deps including 3 getters }) (T-224 6b)
L4626       const server = http.createServer(app)
L4634       const wsClients = new Set()
L4638       attachUpstreamFanout({ wsClients, ... 4 getters })          (T-226 7a)
L4646       const startBrokerFanout = _tickFanout.startBrokerFanout
L4652       const wss = mountWs(server, { ... 3 getters })              (T-227 7b)
L4727+      session janitor + telegram bridge + auto-login daemon
L4920+      (async)() => { await init(); await startBrokerFanout(); server.listen(...) }
```

Any future M1.5+ extract MUST:
1. Add its `require('./routes/X')` to the top-of-file require block (T-215 check enforces this in CI).
2. Be called at the right boot-order position (after its deps are declared as `const` OR after the singleton-`let`-binding is created, but the **getter** can be passed at top-level mount because it's evaluated at request time).
3. Update any source-grep tests that pin invariants by reading `server.js` to also (or instead) read the new module.

---

## Reference: every commit this session

```
T-188   SECRETS-AUDIT.md
T-189   inline Save button on Settings → Notifications
T-190   rotate + redact leaked GH PAT
T-191   fix T-189 spec races
T-192   per-channel dirty + optimistic UI
T-193   comprehensive E2E pass
T-194   CODE-AUDIT.md (1057 lines, 6 parallel agents)
T-194a  stale-tree reconciliation
T-195   quick wins + CSRF investigation
T-196   /api/orders/place per-user auth + 2FA
T-197   bundled with T-195/T-196 (TLS audit, removed)
T-198   WS Origin check + legacy unscoped routes
T-198a  relax verifyClient for no-Origin
T-198b  also accept Origin: 'null'
T-198c  fixme 3 specs to break deploy deadlock
T-198d  restore the 3 fixme'd WS specs
T-199   missing systemd unit + CI hardening
T-200   server-level guard tests for /api/orders/place
T-201   scheduled health check + deeper rollback history
T-202   legacy unscoped routes — verify + gate
T-203   /api/me/* vs /api/v1/me/* migration plan
T-204   node_exporter + cadvisor + telegram-bridge systemd
T-205   CSRF token defense-in-depth (soft-fail phase)
T-206   bundled into T-205
T-207   bundled into T-204
T-208   error-state surface pattern across paper/audit/recon/harvest
T-209   Vitest scaffold + 2 starter tests
T-210   master-key rotation script + runbook
T-211   3 more Vitest tests + CI integration
T-212   staging compose to security parity with prod + draft CI job
T-213   first session summary doc (T-212 cutoff — now superseded by this file)
T-214   M1.4 piece 1 — extract routes/strategies.js
T-214a  fix T-214 TDZ violation
T-215   require-order CI check
T-216   M1.4 piece 2 — extract routes/auth.js
T-217   M1.4 piece 3 — extract services/oauth-state.js
T-218   M1.4 piece 4 — extract routes/portfolio.js
T-219   M1.4 piece 5a — extract order validation Sets
T-220   M1.4 piece 5b — extract order rate-limit
T-221   hand-off doc for pieces 6+7
T-223   M1.4 piece 6a — extract /api/orders/dry-run
T-223a  hotfix: restore server.js dropped by ARG_MAX
T-224   M1.4 piece 6b — extract place + cancel + 2fa
T-224a  fix Layer-4 source-grep paths
T-226   M1.4 piece 7a — extract services/tick-fanout.js
T-227   M1.4 piece 7b — extract routes/ws.js (M1.4 COMPLETE)
T-228   P0 hotfix — /api/auth/* destructure-undefined bug
```

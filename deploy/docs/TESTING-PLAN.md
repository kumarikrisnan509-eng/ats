# ATS Testing Plan

**Last updated:** 2026-05-18 (T-168)
**Audience:** ATS operator (rajasekarjavaee@gmail.com / Kite ID ARS209)
**Production endpoint:** https://ats.rajasekarselvam.com
**VM:** Oracle Cloud Ampere A1 (ARM64) at 141.148.192.4 (deployer@)
**Stack:** Docker container `ats-backend` listening on 127.0.0.1:8080, nginx in front

This document maps every test layer across the four environments (local Windows
dev / CI on GitHub-hosted runner / OCI VM / live public site) and lists the gaps
that still need closing.

---

## 1. Test surfaces

| # | Surface             | Where it runs                           | What it protects                                |
|---|---------------------|------------------------------------------|--------------------------------------------------|
| 1 | Pre-commit          | Windows dev machine, manual / .cmd       | Syntax + lockfile drift before push              |
| 2 | CI validate         | GitHub Actions `ubuntu-latest`           | Lint, syntax, unit tests, secret-leak, JSX parse |
| 3 | CI E2E (Playwright) | GitHub Actions (currently non-blocking)  | Live-URL contract: routes, /ws, auth gates       |
| 4 | Build               | GitHub Actions + Buildx → GHCR           | Docker image builds on linux/arm64               |
| 5 | Deploy smoke        | GitHub Actions → SSH to VM → curl health | Public `/api/health` 200 within 30s of rollout   |
| 6 | VM cron / daemons   | OCI VM (systemd timers, cron)            | Auto-login, DR archive, broker reauth, bulk-rotate |
| 7 | Live monitoring     | Manual / browser / curl                  | Continuous health, lag, broker connection         |
| 8 | Periodic exercises  | Manual quarterly                         | DR restore, dependency audit, broker contract     |

---

## 2. Current coverage — what exists today

### 2.1 Local (Windows)

- **CHECK-BEFORE-PUSH.cmd** (T-168) — runs `npm run lock:check` in
  `deploy/backend/` to catch `package.json` ↔ `package-lock.json` drift
  before push (the failure that broke runs #99–#101 in May 2026).
- **SYNC-FROM-GITHUB.cmd** (T-168) — `git fetch && git reset --hard origin/main`
  so local matches GitHub before any new edits.
- **Manual `npm test`** — works in WSL/Linux. On native Windows there is friction
  because `better-sqlite3` compiles a native module; safer to test in WSL or
  inside the Docker container.

### 2.2 CI validate (`.github/workflows/ci.yml`)

- **Syntax-check backend JS** — `node --check` on every `.js` under `deploy/backend/`
- **JSX parse** — `@babel/parser` on every `.jsx` under `src/` (50+ files)
- **Duplicate top-level const guard** — Python regex check; catches the
  fcefb3b bug class where two `.jsx` files declare the same top-level `const`
  and break window.* exports silently
- **Backend unit tests** — `node test/_runner.js` runs 48 test files
  (`371/371` pass when better-sqlite3 builds cleanly). `ATS_TEST_STRICT=1`
  is set so any failure hard-fails CI (T-150).
- **Secret-leak guard** — grep for `ZERODHA_API_SECRET=`, `BEGIN…PRIVATE KEY`,
  `GHCR_TOKEN=ghp_`, plus a check that `master.key`, `audit.log`, `tokens/`
  are never committed
- **Playwright smoke (push to main only)** — runs all 14 E2E specs against the
  live URL, **currently non-blocking** (`continue-on-error: true`)

### 2.3 CI deploy (`.github/workflows/deploy.yml`)

- **Validate workflow** is reused (`uses: ./.github/workflows/ci.yml`) — fail fast
- **Docker build + push** to `ghcr.io/kumarikrisnan509-eng/ats-backend:<short_sha>`
- **scp scripts/compose/nginx to VM** + **deploy-on-vm.sh** to roll the container
- **Post-deploy smoke test** — polls `https://ats.rajasekarselvam.com/api/health`
  every 2 seconds for up to 30 seconds; fails the job if it never returns 200

### 2.4 E2E Playwright suite (`test-e2e/tests/`)

Default target is `https://ats.rajasekarselvam.com`; override with
`ATS_BASE_URL=http://localhost:8080`.

| Spec                              | Guards                                                |
|-----------------------------------|--------------------------------------------------------|
| `smoke.spec.js`                   | Every hash-route renders without console errors        |
| `happy-path.spec.js`              | Anonymous flow → public APIs → auth gate → /ws handshake → health-deep fingerprint |
| `me-endpoints.spec.js`            | Per-user endpoint auth contract (T-67/T-70)           |
| `health-deep-fields.spec.js`      | Broker WS + DR operational signals (T-34/T-37)        |
| `obs-middleware.spec.js`          | Latency / error observability headers (T-78)          |
| `request-id-error.spec.js`        | `x-request-id` propagation (T-79)                     |
| `callback-state-absent.spec.js`   | OAuth callback rejects missing `state`                |
| `internal-header-strip.spec.js`   | Nginx strips internal-token from external requests    |
| `internal-bulk-rotate.spec.js`    | Internal routes (bulk-rotate, seal-token) → 403 public (T-141) |
| `ws-welcome.spec.js`              | WS welcome packet has `{authed,userId,userEmail}` (T-142) |
| `attribution-fake-pnl.spec.js`    | Attribution endpoint contract                          |
| `signals-fake-kpis.spec.js`       | Signals KPI shape contract                             |
| `ai-trace.spec.js`                | AI router trace endpoint contract                      |
| `status-page-fields.spec.js`      | Public status page fields                              |

### 2.5 VM / operational checks

- **Live `/api/health`** — uptime, broker connection, kill switch, liveTrading flag
- **Live `/api/health-deep`** — broker WS state, DR freshness, surveillance/earnings/mf caches
- **`observability.js`** — request latency, error log, `x-request-id` correlation
- **`/api/admin/observability`** — admin endpoint to query observability data
- **`/api/admin/ai-trace` / `ai-replay` / `ai-compare`** — AI call audit + replay
- **`/api/admin/email-status` / `email-test`** (T-166) — SMTP transport verification
- **systemd timer `ats-bulk-rotate.timer`** — periodic secret rotation
- **systemd service `ats-auto-login-daemon.service`** — Zerodha auto-login (T-160ish)

### 2.6 Disaster recovery scripts

- **`ats-archive.sh`** — periodic rclone backup of state/db to remote storage
- **`dr-restore-test.sh`** — restore from archive into ephemeral location, verify integrity
- **`setup-dr-cron.sh`** — installs the cron
- **`backup-credentials.ps1`** — Windows-side credential backup helper

### 2.7 Broker safety

The `BrokerGateway` interface in `deploy/backend/brokers/gateway.js` deliberately
omits `placeOrder` / `cancelOrder` / `modifyOrder`. Backend code can only call
`paper.placeOrder()` (in-process simulation) or the `/api/orders/dry-run` audit
route. Concrete broker classes (`zerodha-broker.js`, `angelone-broker.js`,
`dhan-broker.js`) DO contain a live `placeOrder()` implementation — but it can
only be reached by code that imports the broker module directly and bypasses
the gateway. There is no test that pins this invariant.

---

## 3. Gap analysis — what is NOT tested today

### P0 — fix in the next 1–2 weeks (real risk, low effort)

| Gap | Impact | Suggested fix |
|---|---|---|
| **Playwright E2E is non-blocking** (`continue-on-error: true`) | Real regressions can ship without failing CI | Remove `continue-on-error`. If specs are flaky, fix or quarantine them — don't ignore them globally. |
| **No broker placeOrder safety contract test** | A future refactor could expose `placeOrder` on the gateway and we wouldn't catch it | Add `test/broker-gateway-safety.test.js`: assert `typeof gateway.placeOrder === 'undefined'` for every concrete adapter |
| **No frontend unit/component tests** | 50+ JSX screens; only protected by smoke test that the page renders without console errors | Add Vitest with React Testing Library; start with the high-risk screens: `screen-orders`, `screen-risk`, `screen-modes`, `screen-strategy-lab` |
| **No dependency vulnerability scan in CI** | `npm install` runs with `--no-audit` explicitly. CVEs in transitive deps go undetected | Add `npm audit --audit-level=high` as a separate non-blocking CI step. If clean for 2 weeks, make it blocking |

### P1 — fix in the next month (medium effort, meaningful coverage)

| Gap | Impact | Suggested fix |
|---|---|---|
| **No static security analysis** | Crypto-vault / auth / token handling has no SAST | Enable GitHub CodeQL on the repo (free for private repos under most plans) |
| **No scheduled live health check** | Between deploys we only know the site is down when a user notices | GitHub Actions scheduled workflow that hits `/api/health` + `/api/health-deep` every 15 min during market hours, alerts via email on non-200 |
| **DR rehearsal not scheduled** | `dr-restore-test.sh` exists but no cron / no proof it runs | `setup-dr-cron.sh` may already do this — verify on VM with `systemctl list-timers \| grep dr`. If missing, add monthly schedule + email summary |
| **No load test of WS tick fan-out** | ZerodhaTicker → WebSocket → all subscribed browsers; perf cliff is unmeasured | One-time k6 or `wscat` driver that opens N WS clients to staging, measures p99 message latency vs. tick rate |
| **No staging gate before prod** | Every push to `main` deploys straight to prod | `staging/docker-compose.staging.yml` exists — wire a staging deploy step that runs the E2E suite against staging before promoting to prod |

### P2 — nice to have (lower urgency)

| Gap | Suggested fix |
|---|---|
| Mobile/responsive snapshot tests | Playwright already supports device emulation; add a small mobile spec |
| Accessibility (a11y) | `@axe-core/playwright` injected into existing happy-path spec |
| API schema enforcement | Generate OpenAPI from server.js routes; assert in CI that no route was removed without spec change |
| Synthetic transaction monitoring | A scheduled job that exercises a fake-user happy path (login, watchlist, run a paper order) end-to-end |
| Chaos test (kill broker WS mid-tick) | Intentionally kill Zerodha WS connection, verify reconnect + alert fire within SLO |

---

## 4. Test cadence — when each layer runs

```
Local edit
  └─> CHECK-BEFORE-PUSH.cmd       (manual, before any dep change)
        └─> git push (via API or PUSH-TO-GITHUB.cmd)
              └─> CI validate     (every push, every PR)
                    ├─> syntax + lint + JSX parse + dup-const
                    ├─> backend unit tests (371/371 strict)
                    ├─> secret-leak guard
                    └─> Playwright (push to main only) [SHOULD be blocking; today is not]
              └─> CI build        (push to main only)
              └─> CI deploy       (push to main only)
                    ├─> Docker build → GHCR
                    ├─> scp scripts to VM
                    ├─> deploy-on-vm.sh (container roll)
                    └─> post-deploy smoke test (/api/health)
                    └─> [PROPOSED] scheduled health check every 15min during market hours

Monthly
  └─> dr-restore-test.sh from /opt/ats/scripts/ — verify the backup is actually restorable
  └─> npm audit review (until P0 #4 makes this CI-gated)

Quarterly
  └─> Manual review of /api/admin/observability + audit log: top error patterns
  └─> Re-read INCIDENT-RUNBOOK.md and update for anything broken since last quarter
  └─> SEBI compliance review (static IP whitelist, kill switch, BYOK posture)
```

---

## 5. How to run each layer manually

### 5.1 Local (Windows)

```cmd
REM Before push, after any dep change:
CHECK-BEFORE-PUSH.cmd

REM Pull latest from GitHub at start of session:
SYNC-FROM-GITHUB.cmd
```

### 5.2 Backend unit tests (WSL or Docker)

```bash
cd deploy/backend
npm ci
ATS_TEST_STRICT=1 npm test
# Expect: 371/371 passed
```

### 5.3 Playwright against live

```bash
cd test-e2e
npm install
npm run install-browsers
npx playwright test                                      # against prod
ATS_BASE_URL=http://localhost:8080 npx playwright test   # against local backend
```

### 5.4 Production live checks

```bash
# Quick health
curl -sI https://ats.rajasekarselvam.com/api/health

# Deep health (broker WS, DR, surveillance, earnings, mf-data)
curl -s https://ats.rajasekarselvam.com/api/health-deep | jq .

# Front page integrity
curl -sI https://ats.rajasekarselvam.com/
# Expect: HTTP/2 200, Last-Modified within last deploy window
```

### 5.5 VM checks (SSH)

```bash
ssh deployer@141.148.192.4
sudo systemctl status ats-backend
sudo systemctl list-timers | grep ats
sudo docker logs ats-backend --tail 100
sudo ls -la /etc/ats/                  # master.key + backend.env
```

---

## 6. Open questions for the next session

1. Should the Playwright suite be promoted to blocking in CI? (P0 #1)
   What's the current flake rate? Check the last 10 push-to-main runs.
2. Is `dr-restore-test.sh` actually scheduled on the VM? Need to verify
   `systemctl list-timers` includes it. If not, add cron + email summary.
3. Do we want a staging deploy gate, or accept push→prod with kill-switch
   safety? Staging adds ~2 minutes to every deploy but catches integration
   regressions before they hit users.
4. Should `master.key` be migrated to OCI Vault? Today it lives in
   `/etc/ats/master.key` (root-readable only). For production scale that's
   acceptable; for fully-managed secret rotation it should move.

---

## 7. T-169 implementation status (P0 batch)

Committed in T-169 (this commit):

- **P0 #2 -- Broker placeOrder safety contract test:** DONE
  Added `deploy/backend/test/broker-gateway-safety.test.js` (8 tests).
  Pins (a) BrokerGateway interface has no order-mutating methods, (b) MockBroker
  stays paper-only, (c) server.js has exactly KNOWN_PLACE_ORDER_CALL_SITES=2
  live broker.placeOrder() call sites, (d) .env.example does not pre-enable
  LIVE_ORDERS_ENABLED. All 8 tests pass locally and in CI.

- **P0 #4 -- npm audit step in CI:** DONE (non-blocking)
  Added "Dependency vulnerability scan" step in ci.yml. Runs
  `npm audit --audit-level=high` plus a JSON summary that emits a
  `::notice::npm audit total vulnerabilities: N` line. Currently
  `continue-on-error: true` so we can review the baseline before flipping
  to blocking.

- **P0 #1 -- Playwright failures: surfaced (not yet blocking):** DONE
  Removed the `|| echo "::warning::..."` swallow on the Playwright step.
  Step is still `continue-on-error: true` so deploy still flows, but
  failures now mark RED in the Actions UI instead of silently passing.
  This exposes the 10 known-stale specs listed below.

Deferred to follow-up:

- **P0 #1 follow-up -- Fix the 10 stale Playwright specs:**
  Each is stale relative to the current product (NOT a security regression --
  manual curl verified the live endpoints, see T-169 investigation log).
  Estimated effort: 30-60 minutes per spec.

  | Spec : test | Reality on live | Fix |
  |---|---|---|
  | `smoke.spec.js:39` -- "Paper trading" sidebar text | String not on home page (0 matches in HTML) | Update locator to new landing-page nav, OR remove if "Paper trading" was renamed |
  | `happy-path.spec.js:29` -- same sidebar entries | Same | Same fix |
  | `happy-path.spec.js:42` -- click "Paper trading" link | Same | Same fix |
  | `happy-path.spec.js:74` -- `/api/preflight` checks array shape | `/api/preflight` returns 200 with `{ok, summary, checks: [...]}` -- test assertion drifted from current shape | Update assertion to match current `checks[].severity` / `checks[].id` schema |
  | `happy-path.spec.js:87` -- `/api/status` deploy+broker+market metadata | `/api/status` returns 200 with `{ok, ts, services: {...}}` (different shape) | Update assertion to current `services.*` schema |
  | `happy-path.spec.js:134` (x3) -- `/api/me/positions`, `/orders`, `/funds` return 401 unauthed | All three return **404** (`{ok:false, reason:"not_found"}`) -- routes were renamed | Either remove these specs, OR re-point to the new `/api/me/*` paths; the security posture remains correct |
  | `happy-path.spec.js:153` -- `POST /api/orders/place` returns 401 without session | Returns 400 `missing:strategyTag` because schema-validation runs before auth | Pre-fill a valid body so auth-gate fires, OR change assertion to accept 400 for empty body |
  | `signals-fake-kpis.spec.js:16` -- Signals does not ship hardcoded KPIs | Likely passing-but-flaky depending on signal cache state; needs in-spec investigation | Re-run in isolation; if flake, add retry, if real, fix the underlying hardcode |

- **P0 #1 final step -- Promote Playwright to blocking:**
  Once the 10 stale specs are fixed, remove `continue-on-error: true` from the
  Playwright step in ci.yml. Verify with one push that all 84 specs are green.

- **P0 #3 -- Frontend Vitest scaffold: DEFERRED to P1.**
  Scope is bigger than "low effort" due to project's runtime-Babel + window
  globals setup. Proper scaffolding needs jsdom env, @babel/preset-react
  loader, and a strategy for the window.* exports pattern. Will land in a
  separate ticket alongside the first real component test (likely on
  `screen-orders` since it has the highest risk surface).

## 8. Operator notes from T-169

- **Windows-side local file corruption:** during this work, 28 backend `.js`
  files were found silently truncated in the local Windows working tree
  (server.js, brokers/*.js, db.js, etc.). The truncation happened pre-T-169
  -- GitHub had the correct files all along and the live deploy was unaffected.
  Root cause appears to be a file-lock or sandbox-mount-write interaction.
  **Remediation:** `git fetch origin && git reset --hard origin/main` from a
  fresh PowerShell with no editor/AV holding files open. Verify with
  `git status` showing only intended changes. If reset --hard appears to
  succeed but `wc -l deploy/backend/brokers/gateway.js` shows less than 106,
  close every editor (VS Code in particular) and re-run.

- **Auth-gate stale-test diagnosis:** the four happy-path.spec.js auth tests
  reading "expect 401" but seeing 404/400 are NOT security regressions. The
  underlying endpoints either don't exist anymore (renamed routes) or have
  body-validation gates that fire before auth. Verified with manual `curl`
  against the live URL on 2026-05-18.

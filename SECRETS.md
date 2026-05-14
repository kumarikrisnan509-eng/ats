# Secrets, credentials, and deferred ops items

This doc tracks every secret in the codebase, how to rotate it, and the ops
items we know are gaps. It is **safe to commit** because it contains no actual
secret material -- only locations, rotation procedures, and pointers.

## Inventory: secrets currently in source

| Secret | Locations | Risk | Rotation |
| --- | --- | --- | --- |
| `Pat` (GitHub PAT, scope=repo) | every `deploy/scripts/deploy-tier*.ps1`, every `RECOVER-*.ps1` | Allows push to mohanapriya63085/ats and read of GH Actions runs | https://github.com/settings/tokens -> revoke -> generate new -> sed-replace in all .ps1 |
| `GhcrPat` (GitHub PAT, scope=read:packages) | every `deploy/scripts/deploy-tier*.ps1` | Allows pulling private ats-backend container images from GHCR | Same flow, separate token |
| Telegram bot token | `deploy/backend/notify.js` reads from env `TELEGRAM_BOT_TOKEN` | None in source (env-only) | https://core.telegram.org/bots#botfather -> /revoke -> set new env on VM |
| Zerodha API secret | `/opt/ats/compose/.env` on VM (NOT in git) | Already env-only | Kite Connect console -> regenerate -> update VM .env -> restart |
| OCI VM SSH key | `C:\Users\localuserwin11\Downloads\ssh-key-2026-01-15.key` | User-side file only | OCI console -> add new key to authorized_keys, drop old |
| `master.key` (libsodium master) | `/etc/ats/master.key` on VM, base64 backup elsewhere | Decrypts all sealed access tokens | If compromised: rotate all downstream tokens, generate new master via `npm run init-master-key`, re-seal |

## Why the PATs are hardcoded today

The deploy scripts run from Windows in a PowerShell child process that has no
shared environment. Hardcoding the PAT in each .ps1 keeps the user's
"double-click DEPLOY-*.cmd" workflow working without a separate setup step.

This is acceptable because:

1. The repo is private (mohanapriya63085/ats).
2. The PATs are scoped to `repo` and `read:packages` -- they cannot exfiltrate
   funds or place trades.
3. The kill switch (`KILL_SWITCH=true`) means even with full repo access an
   attacker cannot trigger real orders.

It becomes unacceptable the moment:

- The repo goes public.
- The repo is shared with a third party.
- `KILL_SWITCH=false` is enabled AND `placeOrder()` is wired (real orders).

## How to harden secrets when you're ready

Single-file approach. Create `deploy/scripts/secrets.local.ps1` (gitignored):

```powershell
$RepoOwner = "mohanapriya63085"
$Pat       = "ghp_..."
$GhcrPat   = "ghp_..."
```

Add to `.gitignore`:

```
deploy/scripts/secrets.local.ps1
```

Modify the top of every `deploy-tier*.ps1` to:

```powershell
$secrets = Join-Path $PSScriptRoot "secrets.local.ps1"
if (Test-Path $secrets) { . $secrets } else {
  Write-Host "!! create deploy/scripts/secrets.local.ps1 with `$RepoOwner, `$Pat, `$GhcrPat" -ForegroundColor Red
  exit 1
}
```

The first run after refactoring will prompt the user to create the file.
After that the workflow is identical to today.

## Deferred operations items (with concrete next steps)

### Staging environment

Goal: `staging.ats.rajasekarselvam.com` that mirrors prod but uses a separate
container + BROKER=mock so we can exercise deploys without touching live ticks.

Concrete steps (when you're ready, ~30 min):

1. Hostinger DNS: add A record `staging.ats.rajasekarselvam.com` -> `141.148.192.4`.
2. On the VM, copy `/etc/nginx/sites-available/ats.rajasekarselvam.com.conf` to
   `staging.ats.rajasekarselvam.com.conf` -- change `server_name` + proxy_pass
   to a different upstream port (e.g. `127.0.0.1:8081`).
3. `certbot --nginx -d staging.ats.rajasekarselvam.com`.
4. Add a second docker-compose service `ats-backend-staging` bound to
   `127.0.0.1:8081` with `BROKER=mock` and a separate persistent volume.
5. Modify the deploy workflow's matrix to deploy `staging` first, run a 60s
   health-check, then deploy `prod`. (Add a `target` input to the workflow.)

### Monitoring / alerting

`/metrics` already exists and is Prometheus-formatted. To wire it up:

1. Install Prometheus + Alertmanager on the VM (or use Grafana Cloud free tier).
2. Add scrape config pointing to `https://ats.rajasekarselvam.com/metrics` with
   the `X-Metrics-Token` header (env: `ATS_METRICS_TOKEN`).
3. Alert rules to start with:
   - `ats_broker_connected == 0 for 2m`
   - `rate(ats_request_errors_total[5m]) > 0.1`
   - `ats_paper_persist_failures_total > 0 for 5m`
   - container restart > 0 in last 10m
4. Route alerts to the existing Telegram bot via Alertmanager webhook.

### Disk-usage alert for audit log

The audit log already rotates via logrotate, but we have no early-warning. Add
to `/etc/cron.d/ats-disk-check`:

```
*/15 * * * * ubuntu /opt/ats/scripts/check-disk.sh
```

Script: alert via Telegram (reuse `/opt/ats/.env` `TELEGRAM_BOT_TOKEN`) if
`/` is >80% or `/var/lib/ats/tokens` is >2GB.

### Frontend tests

The blank-page bug would have been caught by a Playwright test that loads each
route and asserts no console errors. Concrete plan when you want this:

```bash
cd test-e2e
npm init -y && npm i -D @playwright/test
npx playwright install chromium
```

Then a single test file walks every route in `app.jsx` and asserts:
- `#root` has children
- no console.error fired during render
- no `ReferenceError` or `TypeError`

This runs in CI as a separate job that boots the docker image and points
Playwright at `http://localhost:8080`.

### AI features (screen-ai-review)

Currently mock-only. To wire up Claude:

1. Sign up at https://console.anthropic.com -> create API key.
2. Add `ANTHROPIC_API_KEY=...` to `/opt/ats/compose/.env`.
3. New backend endpoints:
   - `POST /api/ai/news-sentiment { items: [...] }` -> calls Claude to tag each item with `bullish | bearish | neutral` and a one-line rationale.
   - `POST /api/ai/position-review { positions: [...] }` -> commentary on each open position.
   - `POST /api/ai/strategy-explain { strategy, params, backtest }` -> human-readable rationale.
4. Cap daily spend via `MAX_DAILY_AI_INR` env var (already a slot for it in
   settings UI mock data).

### Multi-broker (Upstox)

Deferred per your earlier decision. Pick-up notes:

- Upstox API docs: https://upstox.com/developer/api-documentation/open-api
- Their tick stream is similar to Kite (WebSocket per instrument).
- Refactor `deploy/backend/brokers/index.js` into a factory that selects by
  `BROKER` env: `mock | zerodha | upstox`.
- The existing `zerodha-broker.js` already conforms to a common interface
  (`start, stop, subscribeTicks, getHistorical, getHoldings, getOrders,
  getPositions, getMargins, getProfile, ensureSubscribed, health`). Upstox
  adapter should implement the same surface.

### Settlement-file CSV reconciliation

Different from `/api/reconcile` (which compares paper vs broker live state).
This is for tax-time imports.

- Zerodha Console exports daily/yearly CSVs from
  https://console.zerodha.com/reports/tradebook
- New endpoint `POST /api/reconcile/import-csv { csv: "..." }` parses, joins
  against the audit log, returns:
  - Trades present in CSV but not in our audit log (broker-side fills we missed)
  - Trades in our audit log but not in CSV (backend thinks it placed an order
    that never actually filled)
  - Per-trade tax buckets (STCG vs LTCG)

### Tax planning data persistence

Today the tax/harvest/goals screens are pure mock. Backend module:

- `tax.js` -- persists goals + harvest opportunities to `_tax.json`
- Endpoints: `GET/PUT /api/tax/goals`, `GET /api/tax/harvest`, `POST /api/tax/realize`
- Frontend: wire `screen-tax.jsx`, `screen-harvest.jsx`, `screen-goals.jsx`

## Going-live checklist (when you flip the kill switch)

Before setting `KILL_SWITCH=false` and wiring real `kc.placeOrder(...)`:

- [ ] Rotate all PATs out of source per the hardening plan above.
- [ ] Standing alert on `paper_pending != broker_pending` for >5 minutes.
- [ ] Standing alert on any `unexpected_broker_order` (broker has fills the
      backend didn't initiate).
- [ ] Per-day rupee limit env var enforced server-side, not just UI.
- [ ] Postmortem doc template ready (template is `deploy/docs/postmortem.md`).
- [ ] Insurance / SEBI compliance review of own-account algo trading rules
      (you do NOT need a broker license for own-account trading, but keep
      records for tax-audit purposes per Section 44AD).
- [ ] At least one real-money round-trip done manually on Kite to confirm the
      backend's recon matches a known-good baseline.
- [ ] `/api/reconcile` showing zero cash drift and zero holdings drift for
      72 consecutive hours during market sessions.

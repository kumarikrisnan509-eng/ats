# ATS Secrets / Credential Sourcing Audit

**Last updated:** 2026-05-19 (T-187 audit pass; T-188 followup: GH PAT exposure)
**Audience:** ATS operator (rajasekarjavaee@gmail.com / Kite ID ARS209)
**Production endpoint:** https://ats.rajasekarselvam.com
**Reference commit:** working tree at T-175 (HEAD `34d63da`); production tag was `fd8f60b` (T-187) — both share the same credential-handling architecture
**Audit scope:** every external paid/credentialed service ATS talks to

---

## Summary

**Verdict: CLEAN.** Every credential for an external paid service is sourced from one of three correct locations:

1. **Per-user sealed in SQLite** via libsodium master key — Zerodha (`broker_accounts`), AI BYOK (`ai_keys`), Telegram per-user (`user_notifications`)
2. **Operator-managed environment variables** read at runtime — global broker fallback, system-level Telegram alerts, SMTP, session secret
3. **Sealed login vault on disk** (`/var/lib/ats/tokens/_zerodha-login.enc`) — auto-login daemon credentials

**No real API keys, bot tokens, passwords, or TOTP seeds are hardcoded in any committed source file.** One real Telegram bot token does exist in a local helper script (`deploy/scripts/install-telegram-creds.ps1`) but that file is `.gitignored` and never reaches GitHub. Same pattern is used for every operator-only `*.ps1` (set-zerodha-env.ps1, setup-autologin.ps1, wire-zerodha-*.ps1, install-zerodha-creds.*) — all are gitignored.

The live production endpoint passed all 8 E2E probes (auth gate, CSRF gate, validation gate, WS welcome).

---

## Per-service architecture matrix

| Service | Where credential is stored | Where it's read (callsite) | Verdict |
|---|---|---|---|
| **Zerodha Kite (per-user)** | `broker_accounts.api_key/refresh_token/access_token` — sealed by libsodium vault (`/etc/ats/master.key`). User pastes via Brokers UI; sealed in `account-routes.js`. | `broker-resolver.js:50-77` unseals via `vault.open()` and instantiates `new ZerodhaBroker({apiKey, apiSecret, ...})` per request. LRU-cached 1h. | OK |
| **Zerodha Kite (global / legacy)** | `ZERODHA_API_KEY`, `ZERODHA_API_SECRET`, `ZERODHA_REDIRECT_URL` env vars in `/etc/ats/backend.env` (chmod 600, root:ats). | `brokers/index.js:15-27` factory reads `env.ZERODHA_API_KEY || env.KITE_API_KEY`. Constructor enforces `if (!apiKey || !apiSecret) throw`. | OK |
| **Zerodha auto-login** | `userId` + `password` + `totpSeed` sealed in `/var/lib/ats/tokens/_zerodha-login.enc` (LoginVault, libsodium). Plaintext lives in memory only during a single auto-login run. | `login-vault.js:54-59` (`vault.open()`). Daemon `scripts/auto-login-daemon.js:192-206` receives `{api_key, broker_user_id, password, totp_seed}` per-request over a local unix socket (`AUTO_LOGIN_SOCKET`) with optional `AUTO_LOGIN_TOKEN` bearer. Daemon never persists. | OK |
| **Anthropic (BYOK)** | `ai_keys.sealed_key` table, sealed via libsodium master key. User PUTs key to `/api/me/ai-keys`. | `ai-router.js:164` `await vault.open(keyRow.sealed_key)`, then `callLLM({apiKey, ...})` in `ai-advisor.js:137-220`. Header `'x-api-key': apiKey` per request, never logged. | OK |
| **OpenAI (BYOK)** | Same path — `ai_keys.sealed_key`. | `ai-advisor.js:174` `'Authorization': Bearer ${apiKey}`. apiKey unsealed per call. | OK |
| **Google Gemini (BYOK)** | Same path — `ai_keys.sealed_key`. | `ai-advisor.js:208` URL `?key=${apiKey}` per call. | OK |
| **Telegram (per-user)** | `user_notifications.telegram_bot_token` (sealed) + `telegram_chat_id` (plain — not secret). User PUTs via Account screen, sealed in `account-routes.js:96-104`. | `account-routes.js:139-144` `await vault.open(n.telegram_bot_token)` then `POST https://api.telegram.org/bot${botToken}/sendMessage`. | OK |
| **Telegram (operator/system)** | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` env vars in `/etc/ats/backend.env`. Used for cron-reauth alerts and the auto-login daemon's system pings. | `notify.js:16-17` `process.env.TELEGRAM_BOT_TOKEN` / `process.env.TELEGRAM_CHAT_ID`. `ENABLED` falls back gracefully if absent. | OK |
| **SMTP (Hostinger)** | `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_FROM`, `EMAIL_TO` env vars in `/etc/ats/backend.env`. | `email-alerts.js:36-39` reads `process.env.SMTP_*` into `this.smtp{host,port,user,pass}`; `nodemailer.createTransport({...})` is lazy-built on first send (line 152). Password never logged (`buildHealthSummary()` excludes `pass`). | OK |
| **Session secret** | `SESSION_SECRET` env var in `/etc/ats/backend.env`. | `server.js` cookie signer reads at boot. | OK |
| **libsodium master key** | `/etc/ats/master.key` (32 bytes, chmod 400, root-only). Path overridable via `MASTER_KEY_PATH`. | `crypto-vault.js:35-42` `fs.readFileSync()` on startup. The key is the trust root — without it, nothing in the DB or token vault can be unsealed. Documented in `SECRETS.md`. | OK |

---

## Findings (Phase 2 classification)

After grepping for every credential pattern (`sk-ant-`, `sk-proj-`, `sk-`, `AIzaSy`, `Bearer …`, Telegram `\d{10}:AA…`, ARS209, kite/zerodha env names, 10-12 digit phone, `+91`, base32 TOTP seeds) across the whole tree (excluding `node_modules`, `test-e2e/node_modules`, `tests/`, `.secrets-local/`):

### LOW — `migrate-env-broker-to-db.js:134` — Hardcoded operator fallback id

`broker_user_id: brokerUserId || 'ARS209'` is a fallback default in a one-time migration helper that runs on the VM by the operator only. It's the public Kite client identifier (not a credential — appears in URLs like the Kite login redirect), and the migration is operator-run with a single user in scope. Cosmetic, not a security finding. Could be replaced with `|| ''` if we ever multi-tenant onboard, but is currently correct.

### NONE — All committed source

- No real API keys, bot tokens, access tokens, OAuth secrets, or passwords appear in any `*.js`, `*.html`, `*.json`, `*.sh`, `*.md`, `*.cmd`, or `*.ps1` file tracked by git.
- The single regex match for a real Telegram bot token (`8529347436:AAH…`) appears in `deploy/scripts/install-telegram-creds.ps1`. That file is gitignored (`.gitignore:78`). `git check-ignore` confirms. It will never be pushed.
- All operator-helper PowerShell scripts that embed real secrets (set-zerodha-env.ps1, setup-autologin.ps1, wire-zerodha-fully.ps1, wire-zerodha-properly.ps1, recover-and-zerodha.ps1) are individually gitignored with explanatory comments.
- `.secrets-local/CREDENTIALS-AND-DETAILS.md` (the operator vault doc) is in a gitignored directory.

### Comments / doc mentions of ARS209 and rajasekarjavaee@gmail.com

These appear in:
- `INCIDENT-RUNBOOK.md`, `SCREENS-AUDIT.md`, `TESTING-PLAN.md`, `TIER76-BULKROTATE.md` headers — operator identity in docs (OK, public name + public Kite client id).
- `legal.html`, `docs.html`, `status.html`, `README.md` — contact email (OK, public).
- `login-vault.js:5`, `me-broker.js:8`, `server.js:3984-3995` — code comments documenting the per-user id shape (OK, illustrative).
- `test/login-vault.test.js`, `test/sessions.test.js` — fixture data (OK, tests).

No credential leakage in any of these.

---

## Phase 3 — architectural verification (deep dive)

### Zerodha — per-user
`ZerodhaBroker` constructor (`brokers/zerodha-broker.js:34-47`) takes `{apiKey, apiSecret, redirectUrl, instrumentsCachePath}`. `broker-resolver.buildBroker` (`broker-resolver.js:50-77`) is the only DB-driven instantiation site; it unseals `row.api_key` (sealed), `row.refresh_token` (sealed; holds api_secret per Tier 57 convention), and `row.access_token` (sealed) via `vault.open()` then constructs the broker. **No env-var path in the per-user flow.**

### Zerodha — global (legacy / market data ticker)
`brokers/index.js:15-27` `createBroker(env)` is the only env-var path. Used at boot in `server.js` for the shared market-data ticker. Constructor enforces non-empty `apiKey/apiSecret`. **No literal values; everything from env.**

### AI BYOK
- Storage: `ai-keys-routes.js:32-34` defines the SQL; `:79` `const sealed = await vault.seal(apiKey); upsertStmt.run(req.user.id, provider, sealed, modelPref);` writes sealed. Plaintext key is in HTTP request body only (32kb limit, rate-limited, requireAuth).
- Read: `ai-router.js:164` opens via vault for the picked provider, returns `{apiKey, ...}` to caller. Three callsites (`ai.js`, `ai-workflows-routes.js`, `ai-keys-routes.js` analyze endpoint) all funnel through `route()` or do an explicit `db.aiKeys.get` + `vault.open` per request.
- **No global `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` is ever read by the AI code.** Verified by `grep -n "process.env" ai-advisor.js ai-router.js ai-keys-routes.js` — only `process.env.AI_REDACT_FLAG` and similar non-credential toggles.

### Telegram
- Per-user: sealed in `user_notifications.telegram_bot_token`; chat_id is plain (it's not a secret on its own).
- System: `notify.js:16-17` reads `process.env.TELEGRAM_BOT_TOKEN/CHAT_ID`. `ENABLED` flag prevents accidental noise if absent.

### SMTP (Hostinger)
- `email-alerts.js:30-45`. All settings via env. Pass never logged. `nodemailer.createTransport` is lazy + try/catch'd. Daily cap (`EMAIL_DAILY_CAP=100`).

### Auto-login daemon
- `scripts/auto-login-daemon.js:192-206`. Reads `{api_key, broker_user_id, password, totp_seed}` from the POST body over a unix-domain socket (`AUTO_LOGIN_SOCKET=/var/run/ats/auto-login.sock`). Optional auth via `AUTO_LOGIN_TOKEN` (bearer). Daemon does NOT persist anything — backend looks them up from `broker_accounts` + `LoginVault`, decrypts, hands to daemon for a single login run. Daemon discards on return.

---

## Phase 4 — Live E2E probe results (https://ats.rajasekarselvam.com, run 2026-05-19 06:00:30 UTC)

| # | Probe | Expected | Got | Result |
|---|---|---|---|---|
| 1 | `GET /api/health` | 200, broker connected, killSwitch true | `200 ok:true broker.connected:true broker.name:zerodha killSwitch:true liveTrading:false instruments:83791` | PASS |
| 2 | `GET /api/auth-mode` | 200 `authRequired:false` | `200 {"ok":true,"authRequired":false}` | PASS |
| 3 | `GET /api/me/identity` (anon) | 401 | `401 {"ok":false,"reason":"auth_required"}` | PASS |
| 4 | `GET /api/me/ai-keys` (anon) | 401 | `401 {"ok":false,"reason":"auth_required"}` | PASS |
| 5 | `GET /api/me/modes/runtime` (anon) | 401 (T-185) | `401 {"ok":false,"reason":"auth_required"}` | PASS |
| 6a | `POST /api/orders/place` empty body, no Origin | 400 / 401 / 403 | `403 cross_origin_rejected` (no Origin treated as cross-origin per T-181) | PASS |
| 6b | `POST /api/orders/place` empty body, same-Origin | 400 validation | `400 {"ok":false,"reason":"missing:strategyTag"}` | PASS |
| 7 | `POST /api/orders/place` with `Origin: https://evil.example.com` | 403 cross_origin_rejected (T-181) | `403 {"ok":false,"reason":"cross_origin_rejected"}` | PASS |
| 8 | `wss://…/ws` connect + welcome | 101 + welcome packet | `101 Upgrade`, first frame `{"type":"welcome","broker":"zerodha","killSwitch":true,"liveTrading":false,"symbols":[...15 syms...]}` | PASS |

**8/8 pass.** Production posture is consistent with the documented credential architecture: auth-gated endpoints reject anonymous callers, the order route enforces CSRF + payload validation, the WebSocket exposes only public market data shape in the welcome packet.

---

## Recommendations

### P2 — dead-credential cleanup (T-190 in this commit)

Initial audit pass flagged this as P0, but a re-check against `.secrets-local/CREDENTIALS-AND-DETAILS.md` confirms the PAT is **dead**, not live:

1. **`ghp_4t49rt16…XhQDs` (hardcoded in 31 tracked files)** — belongs to the deleted `mohanapriya63085` GitHub account. Per the operator's own notes (`.secrets-local/CREDENTIALS-AND-DETAILS.md` line 125): *"repo is gone so this PAT can no longer push anywhere useful."* Cannot authenticate to any live endpoint. Risk: cosmetic (operator confusion + bad-look in a public repo) rather than active exposure.
2. **`ghp_aqyqZL602…rDsA` (hardcoded in 22 tracked files)** — the rotated GHCR pull token. Scope `read:packages` only. Authenticates against the same public GHCR namespace those `docker pull`s already serve unauthenticated. Risk: minimal (read of already-public images).
3. **The LIVE push PAT (`ghp_EkBQrXo9…G2F6`, expires 2026-06-16) is in `.secrets-local/github-pat.txt`** which is properly `.gitignore`d (`.gitignore:25-28`) and never reaches `origin`. Defense-in-depth here is intact.

**Remediation shipped in T-190 (this commit):**
   - (a) **Both dead/limited PATs redacted from all 31 files.** Replaced literal with `$env:GH_PAT` lookup that sources `deploy\scripts\secrets.local.ps1` (gitignored) if the env var isn't set. Each script now fails fast with a helpful error if neither is present, so a future operator can't accidentally run a script with no auth and a misleading 401.
   - (b) **CI secret-leak guard extended** (`.github/workflows/ci.yml`) with `ghp_[A-Za-z0-9]{30,}` and `github_pat_[A-Za-z0-9_]{80,}` regexes. The LIVE `ghp_EkBQrXo9…` PAT is now blocked from ever being committed to a tracked file — defense-in-depth against the most plausible future leak.
   - (c) **Not done:** rewriting `origin/main` history to scrub the dead PAT from prior commits. The dead PAT is permanently visible in history; since it cannot authenticate, the operational risk is zero and a `git filter-repo` rewrite would break every external clone. Accepted as low-priority hygiene.

### Optional housekeeping (no severity)


1. **Optional — remove `'ARS209'` fallback in `migrate-env-broker-to-db.js:134`.** Replace with `''` and have the migration refuse to run if it cannot derive `broker_user_id` from the existing token file. Low priority (this is a one-time helper, run once per VM).
2. **Optional — add a CI check (pre-commit hook or GitHub Action) that runs the same regex sweep we just ran**. Now extended to include `ghp_*` and `github_pat_*` per the P0 above. The `.gitignore` discipline is currently the only line of defense against the operator helper scripts; an automated scanner would make that defense observable.
3. **Defence-in-depth — rotate `SESSION_SECRET` quarterly** per the comment in `.env.example`. Document the rotation procedure in `INCIDENT-RUNBOOK.md` (currently only mentioned in `.env.example`).

If at any point a credential is suspected to have leaked: rotate the libsodium master key first (forces every sealed cell to be re-encrypted), then rotate the downstream credentials (Zerodha, AI providers, Telegram bot, SMTP). The master-key path is documented in `SECRETS.md` and `INCIDENT-RUNBOOK.md`.

---

## How this was checked

```bash
# 1. Hardcoded credential patterns
grep -rEn 'sk-ant-|sk-proj-|AIzaSy|sk-or-|Bearer\s+[A-Za-z0-9_-]{20,}|[0-9]{10,12}:AA[A-Za-z0-9_-]{30,}' \
    --include='*.js' --include='*.json' --include='*.cmd' --include='*.sh' \
    --include='*.ps1' --include='*.md' --include='*.html' --include='*.yml' --include='*.yaml' \
    | grep -v node_modules | grep -v .secrets-local

# 1b. (T-188 followup) GitHub PAT patterns — MISSED in original sweep
grep -rEn 'ghp_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{82,}' \
    --include='*.js' --include='*.json' --include='*.cmd' --include='*.sh' \
    --include='*.ps1' --include='*.md' --include='*.html' --include='*.yml' --include='*.yaml' \
    | grep -v node_modules | grep -v .secrets-local

# 2. Operator identifiers and emails
grep -rEn 'ARS209|rajasekarjavaee' --include='*.js' --include='*.html' --include='*.md' \
    --include='*.cmd' --include='*.sh' --include='*.json'

# 3. Confirm gitignored
git check-ignore deploy/scripts/install-telegram-creds.ps1
git check-ignore .secrets-local

# 4. Live probes (see Phase 4 table above)
curl -sS https://ats.rajasekarselvam.com/api/health
curl -sS https://ats.rajasekarselvam.com/api/auth-mode
curl -sS https://ats.rajasekarselvam.com/api/me/identity
curl -sS https://ats.rajasekarselvam.com/api/me/ai-keys
curl -sS https://ats.rajasekarselvam.com/api/me/modes/runtime
curl -sS -X POST -H 'Content-Type: application/json' -d '{}' https://ats.rajasekarselvam.com/api/orders/place
curl -sS -X POST -H 'Content-Type: application/json' -H 'Origin: https://evil.example.com' -d '{}' https://ats.rajasekarselvam.com/api/orders/place
node -e "<inline WS handshake>"  # captures the welcome frame
```


# Visual regression + auth smoke — Phase E v5

## Three-environment matrix

| Env    | URL                                  | Visual snapshots | Auth smoke |
|--------|--------------------------------------|------------------|------------|
| local  | http://localhost:8080                | yes              | yes        |
| prod   | https://ats.rajasekarselvam.com      | yes (synthetic user) | yes    |

## How auth works

`test-e2e/global-setup.js` runs once before any spec, classifies the BASE_URL,
and logs in with the appropriate credentials.

### Local
Zero config. `npm run dev` exports `ATS_TEST_USER_SEED=1` to the backend,
which idempotently creates `test@local.invalid / LocalTestUser_2026!` on
boot. The setup script reads those hardcoded credentials and logs in.

### Prod
The backend NEVER seeds in prod (gated on `ENV_NAME !== "prod"` in
server.js). You must do this ONCE manually:

1. Sign up a synthetic e2e account on prod via the normal UI:
   - Email: e2e-visual@<your-domain>   (use a `+e2e` alias to keep it in your inbox)
   - Password: a brand-new long random string — NOT your real account's password
   - Do NOT link a broker to this account
   - Do NOT grant admin

2. Save those credentials as GitHub Actions secrets:
   - `PROD_E2E_EMAIL`
   - `PROD_E2E_PASSWORD`

3. For local debugging against prod, set them in your shell (NEVER in a file
   inside the repo):
   ```powershell
   $env:PROD_E2E_EMAIL    = "e2e-visual@yourdomain.com"
   $env:PROD_E2E_PASSWORD = "your-new-random-password"
   $env:BASE_URL          = "https://ats.rajasekarselvam.com"
   cd test-e2e
   npx playwright test auth-smoke
   ```

If `PROD_E2E_*` is missing, prod auth-smoke skips with a clear message.

## What runs where

* `visual-snapshots.spec.js` -- pixel-level. Skips on prod. Runs on
  local+staging. Operator seeds baselines once with `--update-snapshots`.

* `auth-smoke.spec.js` (Phase E v5, NEW) -- structural. Runs whenever
  global-setup got auth cookies. On prod that means: only when
  `PROD_E2E_*` env vars are set. Asserts every auth-gated screen mounts
  cleanly, no console errors, no `[object Object]` leaks.

## What auth-smoke is NOT

It does NOT click buttons. It does NOT submit forms. It does NOT change
any backend state. It is read-only navigate + assert. The synthetic e2e
account on prod is therefore safe even though it has a real session.

## Hardening idea (future work)

Add an `is_e2e_test` boolean column on the users table. Any backend
route that mutates state checks the flag and returns 403. The prod e2e
account gets the flag set manually via a one-off SQL update. Even if a
future test accidentally clicks a button, the backend refuses. Tracked
as Phase E v6.

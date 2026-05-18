# Tier 76: Per-user daily TOTP rotation — host script contract

This doc describes the two backend routes shipped in **T-133 (Phase 1)** and the
host-side Playwright script (**Phase 2**, deferred) that consumes them.

## Architecture

```
VM host (systemd timer @ 05:45/09:00/13:00 IST)
   │
   │  loops over eligible users
   ▼
   1. POST http://127.0.0.1:8080/api/admin/internal/bulk-rotate
      headers: X-ATS-Internal: 1
      ◂── { accounts: [{ user_id, api_key, api_secret, totp_seed, password, login_url, ... }] }
   │
   ▼  for each account row:
   2. Playwright headless Chromium:
      - goto(login_url)
      - fill user_id + password
      - generate TOTP from totp_seed (use `speakeasy` or `otplib`)
      - fill TOTP
      - submit, capture redirect URL containing ?request_token=…
      - exchange request_token via Kite API:
            POST https://api.kite.trade/session/token
            { api_key, request_token, checksum=SHA256(api_key + request_token + api_secret) }
        ◂── { data: { access_token, ... } }
   │
   ▼
   3. POST http://127.0.0.1:8080/api/admin/internal/seal-token
      headers: X-ATS-Internal: 1
      body: { user_id, id, access_token, issued_at?, expires_at? }
      ◂── { ok: true, id, issued_at, expires_at }
```

## Why both routes need `X-ATS-Internal` + private IP

The credentials cross the loopback unsealed (otherwise the host script needs the
master key, defeating the vault). Defense-in-depth:

- `nginx` strips `X-ATS-Internal` from public traffic (regression-tested by
  `test-e2e/tests/internal-header-strip.spec.js`).
- `requireInternal()` rejects any source IP that isn't loopback or RFC-1918
  private.

## Route reference

### POST `/api/admin/internal/bulk-rotate`

Returns plaintext credentials for every user opted into auto-reauth.

**Request body:** none (POST is just to match the other internal write routes; can be empty `{}`).

**Response:**
```json
{
  "ok": true,
  "count": 3,
  "accounts": [
    {
      "id": 1,                          // broker_accounts.id
      "user_id": "u_abc",                // app user id
      "broker": "zerodha",
      "broker_user_id": "ARS209",        // Kite user id
      "api_key": "xxxxxxxx",
      "api_secret": "xxxxxxxx",
      "totp_seed": "BASE32SECRETXXX",
      "password": "user's Kite login password",
      "login_url": "https://kite.zerodha.com/connect/login?v=3&api_key=..."
    }
  ],
  "errors": [
    { "id": 4, "user_id": "u_xyz", "reason": "unseal_failed", "detail": "..." }
  ]
}
```

Eligibility (set in `db.brokers.listEligible`): `auto_reauth_enabled=1` AND all
four sealed columns present.

### POST `/api/admin/internal/seal-token`

Persists a freshly-rotated access_token. Seals via Vault and writes via the same
`db.brokers.updateTokens` path the in-app cron-reauth uses.

**Request body:**
```json
{
  "user_id": "u_abc",       // required
  "id": 1,                  // optional; resolved by (user_id, broker='zerodha') if absent
  "access_token": "abc123…",// required, plaintext from Kite session/token
  "issued_at":  "2026-05-18T05:46:11.000Z",   // optional, default = now
  "expires_at": "2026-05-19T05:46:11.000Z"    // optional, default = now + 24h
}
```

**Response:**
```json
{ "ok": true, "id": 1, "broker_user_id": "ARS209", "issued_at": "...", "expires_at": "..." }
```

Also stamps `broker_accounts.last_test_at` / `last_test_ok=1` so the Brokers UI
turns green automatically.

## Host script skeleton (Phase 2 — to be authored)

```js
// /opt/ats/scripts/bulk-rotate.js — runs on VM host, NOT in the container
const { chromium } = require('playwright');
const { totp } = require('otplib');
const crypto = require('crypto');
const fetch = require('node-fetch');

const BASE = 'http://127.0.0.1:8080';
const HDR  = { 'X-ATS-Internal': '1', 'Content-Type': 'application/json' };

(async () => {
  const bundle = await (await fetch(`${BASE}/api/admin/internal/bulk-rotate`, {
    method: 'POST', headers: HDR, body: '{}',
  })).json();

  for (const acct of bundle.accounts) {
    try {
      const browser = await chromium.launch({ headless: true });
      const page = await browser.newPage();
      await page.goto(acct.login_url);
      await page.fill('#userid', acct.broker_user_id);
      await page.fill('#password', acct.password);
      await page.click('button[type=submit]');
      await page.fill('#totp', totp.generate(acct.totp_seed));
      await page.click('button[type=submit]');

      // Capture request_token from the redirect.
      const resp = await page.waitForURL(/request_token=/);
      const url = new URL(page.url());
      const requestToken = url.searchParams.get('request_token');
      await browser.close();

      // Exchange via Kite directly.
      const checksum = crypto.createHash('sha256')
        .update(acct.api_key + requestToken + acct.api_secret).digest('hex');
      const ex = await (await fetch('https://api.kite.trade/session/token', {
        method: 'POST',
        headers: { 'X-Kite-Version': '3', 'Content-Type': 'application/x-www-form-urlencoded' },
        body: `api_key=${encodeURIComponent(acct.api_key)}&request_token=${requestToken}&checksum=${checksum}`,
      })).json();

      if (!ex.data || !ex.data.access_token) {
        console.error(`[bulk-rotate] ${acct.user_id} exchange failed:`, ex);
        continue;
      }

      // Seal back.
      await fetch(`${BASE}/api/admin/internal/seal-token`, {
        method: 'POST', headers: HDR,
        body: JSON.stringify({
          user_id: acct.user_id,
          id: acct.id,
          access_token: ex.data.access_token,
        }),
      });
      console.log(`[bulk-rotate] ${acct.user_id} OK`);
    } catch (e) {
      console.error(`[bulk-rotate] ${acct.user_id} threw:`, e.message);
      // (Telegram notify hook goes here when Phase 6 backlog item ships.)
    }
  }
})();
```

## systemd unit for Phase 2

```ini
# /etc/systemd/system/ats-bulk-rotate.timer
[Unit]
Description=Daily per-user Kite token rotation

[Timer]
# 05:45 IST weekdays — Kite refuses login before 5am IST anyway.
OnCalendar=Mon..Fri 00:15:00 UTC
Persistent=true

[Install]
WantedBy=timers.target

# /etc/systemd/system/ats-bulk-rotate.service
[Unit]
Description=ATS bulk per-user Kite rotation
After=network-online.target

[Service]
Type=oneshot
User=deployer
WorkingDirectory=/opt/ats/scripts
ExecStart=/usr/bin/node /opt/ats/scripts/bulk-rotate.js
StandardOutput=append:/var/log/ats/bulk-rotate.log
StandardError=append:/var/log/ats/bulk-rotate.log
```

Add a second timer at 09:00 IST and 13:00 IST for retries — same service.

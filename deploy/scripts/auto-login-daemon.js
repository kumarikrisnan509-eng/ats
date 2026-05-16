// auto-login-daemon.js -- Tier 79: host-side Playwright headless Kite-login worker.
//
// Listens on a Unix socket (default /var/run/ats/auto-login.sock). The container
// bind-mounts the socket and POSTs login requests; we drive Chromium to log in
// to kite.zerodha.com with the supplied user_id + password + TOTP-derived OTP,
// capture the request_token from the redirect URL, and return it.
//
// We never see api_secret or store anything -- the container handles persistence.
//
// Install:
//   npm install playwright otplib
//   npx playwright install chromium
//   sudo cp ats-auto-login-daemon.service /etc/systemd/system/
//   sudo systemctl daemon-reload
//   sudo systemctl enable --now ats-auto-login-daemon
//
// Auth: shared bearer in env AUTO_LOGIN_TOKEN, sent as x-ats-token header.

'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

let chromium;
try { ({ chromium } = require('playwright')); }
catch (e) { console.error('!! playwright not installed:', e.message); process.exit(1); }

// Inline TOTP (RFC 6238, SHA-1, 30s window, 6 digits) -- avoids the otplib ESM mess on Node 18.
const _crypto = require('crypto');
function _base32Decode(s) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  s = String(s).replace(/=+$/, '').replace(/\s/g, '').toUpperCase();
  let bits = '';
  for (const c of s) {
    const idx = ALPHABET.indexOf(c);
    if (idx < 0) throw new Error('invalid base32 char: ' + c);
    bits += idx.toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2));
  return Buffer.from(bytes);
}
const authenticator = {
  generate(secret, when = Date.now()) {
    const key = _base32Decode(secret);
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(when / 30000)));
    const hmac = _crypto.createHmac('sha1', key).update(counter).digest();
    const offset = hmac[hmac.length - 1] & 0xf;
    const code = (
      ((hmac[offset]     & 0x7f) << 24) |
      ((hmac[offset + 1] & 0xff) << 16) |
      ((hmac[offset + 2] & 0xff) << 8)  |
       (hmac[offset + 3] & 0xff)
    ) % 1000000;
    return code.toString().padStart(6, '0');
  }
};

const SOCKET_PATH = process.env.AUTO_LOGIN_SOCKET || '/var/run/ats/auto-login.sock';
const AUTH_TOKEN  = process.env.AUTO_LOGIN_TOKEN  || '';
const KITE_HOST   = 'https://kite.zerodha.com';
const REQUEST_TIMEOUT_MS = 45000;

if (!AUTH_TOKEN) {
  console.error('!! AUTO_LOGIN_TOKEN env var must be set (shared with container)');
  process.exit(1);
}

// Try to remove a stale socket file before bind.
try { fs.unlinkSync(SOCKET_PATH); } catch (_) {}
fs.mkdirSync(path.dirname(SOCKET_PATH), { recursive: true });

let _browser = null;
async function getBrowser() {
  if (_browser && _browser.isConnected()) return _browser;
  _browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
  return _browser;
}

// Drive Kite login: returns request_token from the redirect.
async function driveKiteLogin({ apiKey, brokerUserId, password, totpSeed }) {
  const browser = await getBrowser();
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();

  // Capture request_token from any redirect URL — and CRITICALLY,
  // abort the navigation when Kite redirects to our own /broker-callback
  // so the OAuth-callback handler doesn't consume the token before we exchange it.
  let captured = null;
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    const m = url.match(/[?&]request_token=([^&]+)/);
    if (m && !captured) {
      captured = decodeURIComponent(m[1]);
      // If the URL is on our own host, ABORT it so the request_token isn't consumed.
      if (url.includes('/broker-callback') || url.includes('rajasekarselvam.com')) {
        try { await route.abort(); } catch (_) {}
        return;
      }
    }
    try { await route.continue(); } catch (_) {}
  });
  // Fallback request/response listeners (kept for visibility but no consumption risk).
  page.on('request', (req) => {
    const url = req.url();
    const m = url.match(/[?&]request_token=([^&]+)/);
    if (m && !captured) captured = decodeURIComponent(m[1]);
  });
  page.on('response', (res) => {
    const url = res.url();
    const m = url.match(/[?&]request_token=([^&]+)/);
    if (m && !captured) captured = decodeURIComponent(m[1]);
  });

  try {
    // 1. Hit the connect URL -- forces login flow then redirects back with request_token.
    const connectUrl = `${KITE_HOST}/connect/login?api_key=${encodeURIComponent(apiKey)}&v=3`;
    await page.goto(connectUrl, { waitUntil: 'domcontentloaded', timeout: 20000 });

    // 2. Fill user_id + password.
    await page.fill('input[type="text"]', brokerUserId);
    await page.fill('input[type="password"]', password);
    await page.click('button[type="submit"]');

    // 3. Wait for the TOTP prompt (Kite's PIN/2FA page).
    await page.waitForSelector('input[label="External TOTP"], input[id*="totp"], input[label*="TOTP"], input[type="text"]', { timeout: 15000 });

    // 4. Compute current TOTP from the seed and submit.
    const otp = authenticator.generate(totpSeed.replace(/\s/g, '').toUpperCase());
    // Kite's TOTP input may be the only text input on this page.
    const totpInput = await page.$('input[type="text"], input[type="number"]');
    if (totpInput) await totpInput.fill(otp);
    // The form may auto-submit on 6th digit or need a click.
    const submitBtn = await page.$('button[type="submit"]');
    if (submitBtn) await submitBtn.click().catch(() => {});

    // 5. Wait for redirect to carry request_token (we captured via request hooks above).
    const start = Date.now();
    while (!captured && (Date.now() - start) < 12000) {
      await page.waitForTimeout(250);
    }

    await ctx.close();

    if (!captured) return { ok: false, reason: 'no_request_token_seen' };
    return { ok: true, request_token: captured };
  } catch (e) {
    try { await ctx.close(); } catch (_) {}
    return { ok: false, reason: 'playwright_failed', detail: e.message };
  }
}

const server = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/login') {
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, reason: 'not_found' }));
    return;
  }
  if ((req.headers['x-ats-token'] || '') !== AUTH_TOKEN) {
    res.writeHead(401, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ ok: false, reason: 'unauthorized' }));
    return;
  }
  let buf = '';
  req.on('data', (d) => { buf += d; if (buf.length > 32 * 1024) req.destroy(); });
  req.on('end', async () => {
    let body;
    try { body = JSON.parse(buf); }
    catch (e) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, reason: 'bad_json' }));
      return;
    }
    const { api_key, broker_user_id, password, totp_seed } = body || {};
    if (!api_key || !broker_user_id || !password || !totp_seed) {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, reason: 'missing_fields' }));
      return;
    }
    const timer = setTimeout(() => {
      try {
        res.writeHead(504, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ ok: false, reason: 'timeout' }));
      } catch (_) {}
    }, REQUEST_TIMEOUT_MS);
    try {
      const result = await driveKiteLogin({
        apiKey: api_key, brokerUserId: broker_user_id, password, totpSeed: totp_seed,
      });
      clearTimeout(timer);
      if (res.headersSent) return;
      res.writeHead(result.ok ? 200 : 400, { 'content-type': 'application/json' });
      res.end(JSON.stringify(result));
      // Redact log -- never print credentials.
      console.log(`[${new Date().toISOString()}] login user=${broker_user_id} ok=${result.ok} reason=${result.reason || '-'}`);
    } catch (e) {
      clearTimeout(timer);
      if (res.headersSent) return;
      res.writeHead(500, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: false, reason: 'handler_threw', detail: e.message }));
    }
  });
});

server.listen(SOCKET_PATH, () => {
  // Permission so the container's docker user (uid 1001) can connect.
  try { fs.chmodSync(SOCKET_PATH, 0o666); } catch (_) {}
  console.log(`auto-login-daemon listening on ${SOCKET_PATH}`);
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM, closing');
  try { if (_browser) await _browser.close(); } catch (_) {}
  server.close(() => process.exit(0));
});

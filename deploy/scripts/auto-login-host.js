#!/usr/bin/env node
// auto-login-host.js — runs on the VM HOST (not in container).
// Driven by /etc/cron.d/ats-auto-login at 08:50 IST.
//
// Flow:
//   1. GET  http://127.0.0.1:8080/api/brokers/zerodha/auto-login/bundle
//      → receives loginUrl + userId + password + totpSeed
//   2. Launch headless Chromium (Playwright)
//   3. Fill user_id + password + TOTP
//   4. Capture redirect to /api/brokers/zerodha/callback?request_token=...
//   5. POST http://127.0.0.1:8080/api/brokers/zerodha/auto-login/exchange
//      with the captured request_token
//   6. Backend exchanges + seals + notifies (notify.js → Telegram)
//
// Host setup:
//   apt install -y nodejs npm
//   sudo npm install -g playwright otplib
//   sudo npx playwright install --with-deps chromium

'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

let otplib, chromium;
try { otplib = require('otplib'); } catch (e) { console.error('Missing otplib:', e.message); process.exit(2); }
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Missing playwright:', e.message); process.exit(2); }

const FAIL_DIR = '/var/log/ats/autologin-failures';
const TIMEOUT  = 90_000;

function jitter(b, s) { return b + Math.floor(Math.random() * s); }
function sleep(ms)    { return new Promise(r => setTimeout(r, ms)); }

function httpRequest({ method, url, headers = {}, body = null }) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const opts = {
      method,
      hostname: u.hostname,
      port: u.port || (u.protocol === 'https:' ? 443 : 80),
      path: u.pathname + u.search,
      headers: { 'X-ATS-Internal': '1', ...headers },
      timeout: 15_000,
    };
    if (body) {
      opts.headers['Content-Type'] = 'application/json';
      opts.headers['Content-Length'] = Buffer.byteLength(body);
    }
    const lib = u.protocol === 'https:' ? https : http;
    const req = lib.request(opts, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: b ? JSON.parse(b) : null }); }
        catch (_) { resolve({ status: res.statusCode, body: b }); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('http timeout')); });
    if (body) req.write(body);
    req.end();
  });
}

async function captureFailure(page, ts, label) {
  try {
    fs.mkdirSync(FAIL_DIR, { recursive: true });
    const file = path.join(FAIL_DIR, `autologin-${ts}-${label}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch (_) { return null; }
}

(async () => {
  const startedAt = new Date();
  const ts = Date.now();
  console.log(`[${startedAt.toISOString()}] auto-login-host: starting`);

  // 1. Get bundle
  const bundleResp = await httpRequest({
    method: 'GET',
    url: 'http://127.0.0.1:8080/api/brokers/zerodha/auto-login/bundle',
  });
  if (bundleResp.status !== 200 || !bundleResp.body || !bundleResp.body.ok) {
    console.error('Failed to fetch bundle:', bundleResp.status, bundleResp.body);
    process.exit(3);
  }
  const { loginUrl, userId, password, totpSeed } = bundleResp.body;
  console.log(`  bundle ok: userId=${userId}, loginUrl length=${loginUrl.length}`);

  // 2. Drive Kite UI
  let browser, page;
  let captured = null;
  try {
    browser = await chromium.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-blink-features=AutomationControlled', '--disable-dev-shm-usage'],
    });
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    page = await context.newPage();

    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('/api/brokers/zerodha/callback') && u.includes('request_token=')) {
        try { captured = new URL(u).searchParams.get('request_token'); } catch (_) {}
      }
    });

    console.log('  navigating to Kite login');
    await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 20_000 });

    // user_id + password
    await page.waitForSelector('input[type=text], input#userid', { timeout: 10_000 });
    await page.fill('input[type=text], input#userid', userId, { timeout: 5_000 });
    await sleep(jitter(150, 300));
    await page.fill('input[type=password]', password, { timeout: 5_000 });
    await sleep(jitter(150, 300));
    console.log('  filled user_id + password');

    await Promise.any([
      page.click('button[type=submit]'),
      page.click('button:has-text("Login")'),
    ]).catch(() => {});

    // TOTP
    await page.waitForSelector(
      'input[label*="TOTP" i], input[placeholder*="TOTP" i], input[label*="External TOTP" i], input[type=number], input[maxlength="6"]',
      { timeout: 10_000 }
    );
    const code = otplib.authenticator.generate(totpSeed);
    console.log(`  generated TOTP (${code.length} digits)`);
    await sleep(jitter(200, 400));
    await page.fill(
      'input[label*="TOTP" i], input[placeholder*="TOTP" i], input[label*="External TOTP" i], input[type=number], input[maxlength="6"]',
      code
    );
    await sleep(jitter(200, 400));
    await Promise.any([
      page.click('button[type=submit]'),
      page.click('button:has-text("Continue")'),
      page.waitForURL(/request_token=/, { timeout: 12_000 }),
    ]).catch(() => {});

    // Wait for the redirect-with-request_token, captured by page.on('request') above.
    const waitStart = Date.now();
    while (!captured && Date.now() - waitStart < 20_000) await sleep(250);

    if (!captured) {
      const shot = await captureFailure(page, ts, 'no-request-token');
      console.error('FAIL: no request_token captured. screenshot:', shot);
      process.exit(4);
    }
    console.log(`  captured request_token (length=${captured.length})`);
  } catch (err) {
    const shot = page ? await captureFailure(page, ts, 'exception') : null;
    console.error('FAIL exception:', err.message, 'screenshot:', shot);
    process.exit(5);
  } finally {
    try { if (browser) await browser.close(); } catch (_) {}
  }

  // 3. POST request_token back to the backend for exchange + sealing.
  const ex = await httpRequest({
    method: 'POST',
    url: 'http://127.0.0.1:8080/api/brokers/zerodha/auto-login/exchange',
    body: JSON.stringify({ requestToken: captured }),
  });
  if (ex.status !== 200 || !ex.body || !ex.body.ok) {
    console.error('Exchange failed:', ex.status, ex.body);
    process.exit(6);
  }
  console.log(`OK: ${ex.body.userId} logged in. Backend will start KiteTicker.`);
})().catch((err) => {
  console.error('UNCAUGHT:', err);
  process.exit(99);
});

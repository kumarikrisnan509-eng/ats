#!/usr/bin/env node
// auto-login-host.js (Tier 30.1) -- runs on the VM HOST (not in container).
// Driven by /etc/cron.d/ats-auto-login at 08:50 IST 7 days/week (T-31).
//
// Hardened for Oracle Cloud Ampere A1 (ARM64). Adds:
//   - per-step logging so a hang reveals which await is stuck
//   - explicit launch timeout (60s) so a hang is observable, not infinite
//   - additional Chromium flags known to fix ARM64 launch hangs
//
'use strict';

const http  = require('http');
const https = require('https');
const fs    = require('fs');
const path  = require('path');

let otplib, chromium;
try { otplib = require('otplib'); } catch (e) { console.error('Missing otplib:', e.message); process.exit(2); }
try { ({ chromium } = require('playwright')); } catch (e) { console.error('Missing playwright:', e.message); process.exit(2); }

const FAIL_DIR = '/var/log/ats/autologin-failures';

function step(label) {
  console.log(`[${new Date().toISOString()}] STEP: ${label}`);
}
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
    const pngFile = path.join(FAIL_DIR, `autologin-${ts}-${label}.png`);
    const txtFile = path.join(FAIL_DIR, `autologin-${ts}-${label}.txt`);
    await page.screenshot({ path: pngFile, fullPage: true });

    // T99-T57: also dump page metadata + visible text so failures are
    // grep-able without needing image transfer + OCR. Best-effort: errors
    // here must not mask the real failure.
    try {
      const url   = await page.url().catch(() => '(url unavailable)');
      const title = await page.title().catch(() => '(title unavailable)');
      const bodyText = await page.evaluate(() => {
        try { return (document.body && document.body.innerText || '').slice(0, 2000); }
        catch (_) { return '(innerText unavailable)'; }
      }).catch(() => '(evaluate failed)');
      const inputs = await page.evaluate(() => {
        try {
          return Array.from(document.querySelectorAll('input,button')).map(el => ({
            tag: el.tagName,
            type: el.type || '',
            name: el.name || '',
            id: el.id || '',
            placeholder: el.placeholder || '',
            text: (el.innerText || '').slice(0, 40),
            visible: !!(el.offsetWidth || el.offsetHeight),
          })).slice(0, 30);
        } catch (_) { return []; }
      }).catch(() => []);
      const dump = [
        '=== auto-login failure dump ===',
        'ts: ' + new Date(ts).toISOString(),
        'label: ' + label,
        'url: ' + url,
        'title: ' + title,
        'screenshot: ' + pngFile,
        '',
        '--- visible body text (first 2000 chars) ---',
        bodyText,
        '',
        '--- input/button elements ---',
        JSON.stringify(inputs, null, 2),
      ].join('\n');
      fs.writeFileSync(txtFile, dump);
    } catch (_e) { /* don't mask main failure */ }

    return pngFile;
  } catch (_) { return null; }
}

(async () => {
  const startedAt = new Date();
  const ts = Date.now();
  step('starting');

  // 0. Self-guard: skip if broker is already connected.
  try {
    const healthResp = await httpRequest({
      method: 'GET',
      url: 'http://127.0.0.1:8080/api/health',
    });
    if (healthResp.status === 200 && healthResp.body && healthResp.body.broker && healthResp.body.broker.connected) {
      step('already connected -- skipping');
      process.exit(0);
    }
  } catch (_e) {
    step('health check failed -- proceeding anyway');
  }

  // 1. Get bundle
  step('fetching auto-login bundle');
  const bundleResp = await httpRequest({
    method: 'GET',
    url: 'http://127.0.0.1:8080/api/brokers/zerodha/auto-login/bundle',
  });
  if (bundleResp.status !== 200 || !bundleResp.body || !bundleResp.body.ok) {
    console.error('Failed to fetch bundle:', bundleResp.status, bundleResp.body);
    process.exit(3);
  }
  const { loginUrl, userId, password, totpSeed } = bundleResp.body;
  step(`bundle ok: userId=${userId}, loginUrl length=${loginUrl.length}`);

  // 2. Drive Kite UI
  let browser, page;
  let captured = null;
  try {
    step('calling chromium.launch() -- ARM64-hardened args, 60s timeout');
    browser = await chromium.launch({
      headless: true,
      timeout: 60_000,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-accelerated-2d-canvas',
        '--no-zygote',
        '--no-first-run',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-default-apps',
      ],
    });
    step('chromium launched');

    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });
    step('context created');

    page = await context.newPage();
    step('page created');

    page.on('request', (req) => {
      const u = req.url();
      if (u.includes('/api/brokers/zerodha/callback') && u.includes('request_token=')) {
        try { captured = new URL(u).searchParams.get('request_token'); } catch (_) {}
      }
    });

    step('navigating to Kite login');
    await page.goto(loginUrl, { waitUntil: 'networkidle', timeout: 20_000 });
    step('Kite login page loaded');

    await page.waitForSelector('input[type=text], input#userid', { timeout: 10_000 });
    await page.fill('input[type=text], input#userid', userId, { timeout: 5_000 });
    await sleep(jitter(150, 300));
    await page.fill('input[type=password]', password, { timeout: 5_000 });
    await sleep(jitter(150, 300));
    step('filled user_id + password');

    await Promise.any([
      page.click('button[type=submit]'),
      page.click('button:has-text("Login")'),
    ]).catch(() => {});
    step('submitted login form');

    await page.waitForSelector(
      'input[label*="TOTP" i], input[placeholder*="TOTP" i], input[label*="External TOTP" i], input[type=number], input[maxlength="6"]',
      { timeout: 10_000 }
    );
    const code = otplib.authenticator.generate(totpSeed);
    step(`generated TOTP (${code.length} digits)`);
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
    step('submitted TOTP, waiting for request_token redirect');

    const waitStart = Date.now();
    while (!captured && Date.now() - waitStart < 20_000) await sleep(250);

    if (!captured) {
      const shot = await captureFailure(page, ts, 'no-request-token');
      console.error('FAIL: no request_token captured. screenshot:', shot);
      process.exit(4);
    }
    step(`captured request_token (length=${captured.length})`);
  } catch (err) {
    const shot = page ? await captureFailure(page, ts, 'exception') : null;
    console.error('FAIL exception:', err.message, 'stack:', err.stack, 'screenshot:', shot);
    process.exit(5);
  } finally {
    try { if (browser) await browser.close(); } catch (_) {}
  }

  // 3. POST request_token back to backend for exchange + sealing.
  step('posting request_token to /auto-login/exchange');
  const ex = await httpRequest({
    method: 'POST',
    url: 'http://127.0.0.1:8080/api/brokers/zerodha/auto-login/exchange',
    body: JSON.stringify({ requestToken: captured }),
  });
  if (ex.status !== 200 || !ex.body || !ex.body.ok) {
    console.error('Exchange failed:', ex.status, ex.body);
    process.exit(6);
  }
  step(`OK: ${ex.body.userId} logged in. Backend will start KiteTicker.`);
})().catch((err) => {
  console.error('UNCAUGHT:', err);
  process.exit(99);
});

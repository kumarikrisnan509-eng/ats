#!/usr/bin/env node
// bulk-rotate.js — daily per-user Kite token rotation.
//
// Tier 76 Phase 2 (T-138). Runs on the VM HOST (not inside the container)
// because Playwright needs the system Chromium binary and the headless
// browser doesn't fit cleanly into the Node Alpine container image.
//
// Flow:
//   1. POST /api/admin/internal/bulk-rotate  ◂── { accounts: [...] }
//   2. For each account:
//      a. Launch headless Chromium, navigate to login_url
//      b. Fill user_id + password
//      c. Generate TOTP from totp_seed (otplib)
//      d. Fill TOTP, submit, capture request_token from redirect
//      e. Exchange via Kite session/token directly (sha256 checksum)
//      f. POST /api/admin/internal/seal-token to persist
//   3. Log per-user OK / FAIL to stdout (systemd captures to journal)
//
// Backend contract: see deploy/docs/TIER76-BULKROTATE.md
// Backend impl: T-133 commit 9273817
//
// Requires (npm install in /opt/ats/scripts):
//   playwright            ^1.49.0
//   otplib                ^12.0.1
//   node-fetch            ^2.7.0      (cjs require)
//
// Cron: systemd timer at 05:45/09:00/13:00 IST weekdays. See sibling
//   bulk-rotate.timer + bulk-rotate.service.
//
// Safety:
//   - INTERNAL_TOKEN env optional; backend protects routes via loopback IP +
//     X-ATS-Internal header. Script must run on the same VM as the container.
//   - On exchange failure for one user, the loop continues to the next.
//     The operator gets a per-user FAIL line in the journal.
//   - Telegram notify-on-failure is wired in P6 (backlog), not here.

'use strict';

const { chromium } = require('playwright');
const { totp } = require('otplib');
const fetch = require('node-fetch');
// T-145: pure-logic helpers extracted into bulk-rotate-helpers.js so they
// can be unit-tested without requiring playwright/otplib/node-fetch.
const { checksum } = require('./bulk-rotate-helpers');

const BASE_URL = process.env.ATS_BASE_URL || 'http://127.0.0.1:8080';
const HEADERS  = { 'X-ATS-Internal': '1', 'Content-Type': 'application/json' };
const KITE_API = 'https://api.kite.trade/session/token';
const NAV_TIMEOUT_MS = 30_000;
const POST_TIMEOUT_MS = 15_000;

// ---------- helpers ----------
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function postJson(url, body, timeoutMs = POST_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: HEADERS,
      body: JSON.stringify(body || {}),
      signal: ctrl.signal,
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, body: j };
  } finally {
    clearTimeout(t);
  }
}

// ---------- per-user rotation ----------
async function rotateOne(account, browser) {
  const tag = `[${account.user_id}/${account.broker_user_id}]`;
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true });
  const page = await ctx.newPage();
  page.setDefaultNavigationTimeout(NAV_TIMEOUT_MS);

  try {
    await page.goto(account.login_url, { waitUntil: 'domcontentloaded' });
    await page.fill('#userid', account.broker_user_id);
    await page.fill('#password', account.password);
    await page.click('button[type=submit]');

    // Kite's TOTP step shows up on the next page. Wait for the input.
    await page.waitForSelector('#totp', { timeout: 10_000 });
    const code = totp.generate(account.totp_seed);
    await page.fill('#totp', code);
    await page.click('button[type=submit]');

    // After successful TOTP, Kite redirects to our callback with request_token=…
    // We want to capture that URL before it actually hits our backend. The
    // redirect target carries the token; we never need to follow it.
    let requestToken = null;
    await Promise.race([
      page.waitForURL(/request_token=/, { timeout: 15_000 })
          .then(() => { requestToken = new URL(page.url()).searchParams.get('request_token'); }),
      page.waitForResponse(r => /request_token=/.test(r.url()), { timeout: 15_000 })
          .then(resp => { requestToken = new URL(resp.url()).searchParams.get('request_token'); }),
    ]).catch(() => {});

    if (!requestToken) {
      console.error(`${tag} FAIL: no request_token captured`);
      return { ok: false, reason: 'no_request_token' };
    }

    // Exchange directly with Kite.
    const ck = checksum(account.api_key, requestToken, account.api_secret);
    const body = new URLSearchParams({
      api_key: account.api_key,
      request_token: requestToken,
      checksum: ck,
    });
    const exR = await fetch(KITE_API, {
      method: 'POST',
      headers: { 'X-Kite-Version': '3', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });
    const ex = await exR.json().catch(() => ({}));
    if (!ex || !ex.data || !ex.data.access_token) {
      console.error(`${tag} FAIL: kite exchange returned`, JSON.stringify(ex).slice(0, 300));
      return { ok: false, reason: 'kite_exchange_failed', detail: ex };
    }

    // Seal it back.
    const seal = await postJson(`${BASE_URL}/api/admin/internal/seal-token`, {
      user_id: account.user_id,
      id: account.id,
      access_token: ex.data.access_token,
    });
    if (!seal.ok) {
      console.error(`${tag} FAIL: seal-token returned ${seal.status}`, JSON.stringify(seal.body).slice(0, 300));
      return { ok: false, reason: 'seal_failed', status: seal.status };
    }
    console.log(`${tag} OK`);
    return { ok: true };
  } catch (e) {
    console.error(`${tag} THREW:`, e && e.message);
    return { ok: false, reason: 'exception', detail: e && e.message };
  } finally {
    await ctx.close().catch(() => {});
  }
}

// ---------- main ----------
(async () => {
  console.log(`[bulk-rotate] starting at ${new Date().toISOString()} against ${BASE_URL}`);

  const bundle = await postJson(`${BASE_URL}/api/admin/internal/bulk-rotate`, {});
  if (!bundle.ok || !bundle.body || !bundle.body.ok) {
    console.error('[bulk-rotate] bundle fetch failed:', bundle.status, JSON.stringify(bundle.body).slice(0, 300));
    process.exit(2);
  }
  const accounts = bundle.body.accounts || [];
  const errors   = bundle.body.errors   || [];
  console.log(`[bulk-rotate] ${accounts.length} eligible account(s); ${errors.length} unseal error(s)`);
  for (const e of errors) console.error(`[bulk-rotate] SKIP ${e.user_id}: ${e.reason} ${e.detail || ''}`);

  if (accounts.length === 0) {
    console.log('[bulk-rotate] nothing to do');
    process.exit(0);
  }

  const browser = await chromium.launch({ headless: true });
  let okCount = 0, failCount = 0;
  try {
    for (const acct of accounts) {
      const r = await rotateOne(acct, browser);
      if (r.ok) okCount++; else failCount++;
      // Small pacing pause — Kite rate-limits aggressive login attempts.
      await sleep(2_000);
    }
  } finally {
    await browser.close().catch(() => {});
  }

  console.log(`[bulk-rotate] done: ${okCount} OK, ${failCount} FAIL, ${errors.length} skipped`);
  process.exit(failCount > 0 ? 1 : 0);
})().catch(e => {
  console.error('[bulk-rotate] FATAL:', e && e.stack || e);
  process.exit(3);
});

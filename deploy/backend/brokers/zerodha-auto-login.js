// zerodha-auto-login.js — Playwright-driven daily login to Kite.
//
// Drives kite.zerodha.com/connect/login through user_id + password + TOTP,
// then catches the redirect to /api/brokers/zerodha/callback?request_token=...
// and returns the request_token to the caller.
//
// Design notes:
//   - Headless Chromium via Playwright (more reliable than puppeteer for Kite's modern UI).
//   - Small randomized jitter on typing/clicks to avoid trivial timing fingerprints.
//   - Screenshots on failure to /var/log/ats/autologin-failures/ for forensic review.
//   - All steps audit-logged.
//
// **Operator advisory:**
//   Zerodha's Terms forbid automating the login UI. This module exists at the operator's
//   explicit request and at their own risk. KILL_SWITCH must remain TRUE in this deployment
//   so the worst-case breach is "attacker can read live ticks", not "attacker can place orders".

const fs = require('fs');
const path = require('path');
const otplib = require('otplib');

const FAIL_DIR = process.env.AUTOLOGIN_FAIL_DIR || '/var/log/ats/autologin-failures';

function jitter(baseMs, spreadMs) {
  return baseMs + Math.floor(Math.random() * spreadMs);
}
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

/**
 * @param {{
 *   userId: string,
 *   password: string,
 *   totpSeed: string,
 *   apiKey: string,
 *   loginUrl: string,         // typically buildLoginUrl() from the broker adapter
 *   timeoutMs?: number,       // overall budget (default 90s)
 *   audit: (event:string, data?:any) => void,
 * }} opts
 * @returns {Promise<{ ok: true, requestToken: string } | { ok: false, error: string, screenshot?: string }>}
 */
async function runAutoLogin(opts) {
  const { userId, password, totpSeed, loginUrl, audit } = opts;
  const timeoutMs = opts.timeoutMs || 90_000;

  // Lazy-require playwright so the backend boots fine even if the dep is missing.
  let chromium;
  try {
    ({ chromium } = require('playwright'));
  } catch (err) {
    return { ok: false, error: `playwright not installed: ${err.message}` };
  }

  const ts = Date.now();
  audit('autologin.start', { userId });

  let browser;
  let page;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-blink-features=AutomationControlled',
        '--disable-dev-shm-usage',
      ],
    });
    const context = await browser.newContext({
      userAgent:
        'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
      viewport: { width: 1280, height: 800 },
    });

    // Intercept the redirect-to-our-callback so we can grab request_token without
    // letting Chromium actually try to navigate to our internal URL.
    let captured = null;
    page = await context.newPage();
    page.on('request', (req) => {
      const url = req.url();
      if (url.includes('/api/brokers/zerodha/callback') && url.includes('request_token=')) {
        try {
          const u = new URL(url);
          const rt = u.searchParams.get('request_token');
          if (rt) captured = rt;
        } catch (_) { /* ignore parse errors */ }
      }
    });

    // Hard timeout for the whole flow.
    const overallTimeout = setTimeout(() => {
      page.close().catch(() => {});
      browser.close().catch(() => {});
    }, timeoutMs);

    audit('autologin.navigate', { loginUrl });
    await page.goto(loginUrl, { waitUntil: 'networkidle' });

    // Step 1: user_id + password.
    await page.waitForSelector('input[type=text], input#userid', { timeout: 10_000 });
    await page.fill('input[type=text], input#userid', userId, { timeout: 5_000 });
    await sleep(jitter(150, 300));
    await page.fill('input[type=password]', password, { timeout: 5_000 });
    await sleep(jitter(150, 300));
    audit('autologin.creds_filled', {});

    // Submit. Kite renames the button between revs; click whatever submit-ish thing is visible.
    await Promise.any([
      page.click('button[type=submit]'),
      page.click('button:has-text("Login")'),
    ]).catch(() => {});

    // Step 2: TOTP. Kite shows a 6-digit OTP field next.
    await page.waitForSelector(
      'input[label*="TOTP" i], input[placeholder*="TOTP" i], input[label*="External TOTP" i], input[type=number], input[maxlength="6"]',
      { timeout: 10_000 }
    );
    const code = otplib.authenticator.generate(totpSeed);
    audit('autologin.totp_generated', { codeLength: code.length });

    await sleep(jitter(200, 400));
    await page.fill(
      'input[label*="TOTP" i], input[placeholder*="TOTP" i], input[label*="External TOTP" i], input[type=number], input[maxlength="6"]',
      code
    );
    await sleep(jitter(200, 400));

    // Submit TOTP. Kite usually auto-submits when 6 digits are entered, but click as a fallback.
    await Promise.any([
      page.click('button[type=submit]'),
      page.click('button:has-text("Continue")'),
      page.waitForURL(/request_token=/, { timeout: 12_000 }),
    ]).catch(() => {});

    // Wait for the redirect to our /callback with the request_token. We don't actually want
    // Chromium to navigate to it (network would fail because the URL is only reachable from
    // inside the VM and we intercept it above), so 'navigation' may error out — that's fine,
    // we use the request hook above.
    const waitStart = Date.now();
    while (!captured && Date.now() - waitStart < 20_000) {
      await sleep(250);
    }

    clearTimeout(overallTimeout);

    if (!captured) {
      const shot = await saveScreenshot(page, ts).catch(() => null);
      audit('autologin.no_request_token', { screenshot: shot });
      return { ok: false, error: 'redirect did not yield request_token within 20s', screenshot: shot };
    }

    audit('autologin.success', { requestTokenLength: captured.length });
    return { ok: true, requestToken: captured };
  } catch (err) {
    const shot = await (page ? saveScreenshot(page, ts).catch(() => null) : null);
    audit('autologin.error', { msg: err.message, screenshot: shot });
    return { ok: false, error: err.message, screenshot: shot };
  } finally {
    try { if (browser) await browser.close(); } catch (_) {}
  }
}

async function saveScreenshot(page, ts) {
  try {
    fs.mkdirSync(FAIL_DIR, { recursive: true });
    const file = path.join(FAIL_DIR, `autologin-${ts}.png`);
    await page.screenshot({ path: file, fullPage: true });
    return file;
  } catch (_) {
    return null;
  }
}

module.exports = { runAutoLogin };

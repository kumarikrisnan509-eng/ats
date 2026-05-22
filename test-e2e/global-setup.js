// test-e2e/global-setup.js -- Phase E v4
//
// Runs ONCE before any spec, logs in as the seeded test user, captures
// the session cookie, and writes it to playwright/.auth/user.json. Specs
// that opt in via test.use({ storageState }) start pre-authenticated.
//
// Skip conditions:
//   - BASE_URL points at prod (we never want to log in as a "test user"
//     against production -- the seed user only exists locally + staging).
//   - The dev backend isn't reachable.
//
// On skip we still write an empty storageState so specs that read it
// don't crash; they should also have their own skip-on-prod check.

const { chromium, request: pwRequest } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const TEST_EMAIL    = 'test@local.invalid';
const TEST_PASSWORD = 'LocalTestUser_2026!';
const AUTH_FILE     = path.resolve(__dirname, 'playwright/.auth/user.json');

function isLocal(baseURL) {
  if (!baseURL) return false;
  return baseURL.includes('localhost') || baseURL.includes('127.0.0.1') ||
         baseURL.includes('staging.ats.rajasekarselvam.com');
}

module.exports = async function globalSetup(config) {
  // Read baseURL from the projects config (first project) -- same lookup
  // playwright.config.js uses.
  const baseURL = (config.projects[0] && config.projects[0].use && config.projects[0].use.baseURL)
               || process.env.BASE_URL
               || process.env.ATS_BASE_URL
               || 'https://ats.rajasekarselvam.com';

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

  if (!isLocal(baseURL)) {
    // Write an empty storage state so test.use({ storageState }) still
    // resolves; protected-screen specs will skip on prod via their own check.
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }, null, 2));
    console.log(`[global-setup] baseURL=${baseURL} is not local; skipping login. Wrote empty ${AUTH_FILE}.`);
    return;
  }

  // Use Playwright's APIRequestContext to POST /api/auth/login + capture
  // the Set-Cookie header. Cleaner than spinning up a browser just to login.
  const ctx = await pwRequest.newContext({ baseURL, ignoreHTTPSErrors: true });
  let cookieHeader = null;
  try {
    const r = await ctx.post('/api/auth/login', {
      data:    { email: TEST_EMAIL, password: TEST_PASSWORD },
      headers: { origin: baseURL },                 // satisfy CSRF
      timeout: 8000,
    });
    if (!r.ok()) {
      const text = await r.text().catch(() => '<no body>');
      throw new Error(`POST /api/auth/login -> ${r.status()}: ${text.slice(0, 200)}`);
    }
    // Pull the cookie Playwright stored on the context
    const cookies = await ctx.storageState();
    if (!cookies.cookies || cookies.cookies.length === 0) {
      throw new Error('login succeeded but no cookies stored');
    }
    fs.writeFileSync(AUTH_FILE, JSON.stringify(cookies, null, 2));
    console.log(`[global-setup] logged in as ${TEST_EMAIL}, saved ${cookies.cookies.length} cookie(s) to ${AUTH_FILE}`);
  } catch (e) {
    console.warn(`[global-setup] login skipped: ${e.message}`);
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }, null, 2));
  } finally {
    await ctx.dispose();
  }
};

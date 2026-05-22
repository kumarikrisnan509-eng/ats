// test-e2e/global-setup.js -- Phase E v5
//
// Runs ONCE before any spec. Logs in as the appropriate test user for the
// current BASE_URL and writes the resulting session cookies to
// playwright/.auth/user.json. Specs that need auth opt in via
// test.use({ storageState: ... }).
//
// Environment matrix:
//
//   localhost / 127.0.0.1
//     Backend boots with ATS_TEST_USER_SEED=1 (set by scripts/dev-server.js).
//     The seed user is `test@local.invalid / LocalTestUser_2026!`. Hardcoded
//     because the seed is also hardcoded server-side; no secret to protect.
//
//   staging.ats.rajasekarselvam.com
//     Same backend seed enabled in staging compose env. Same credentials
//     work because BROKER=mock and DB is isolated. Operator can override
//     via STAGING_E2E_EMAIL / STAGING_E2E_PASSWORD env vars.
//
//   prod (ats.rajasekarselvam.com)
//     The backend NEVER seeds in prod (server.js Phase E v4 gate is
//     ENV_NAME !== "prod"). Operator must manually create a SYNTHETIC
//     e2e-test account on prod via the signup flow:
//        Email:    e2e-visual@<your-domain>   (or +e2e alias)
//        Password: NEW long random string, NOT the real account password
//     Then set PROD_E2E_EMAIL and PROD_E2E_PASSWORD in their local shell
//     or as GitHub Actions secrets. The credentials are NEVER read from
//     a file; only from process.env.
//
// If credentials are unavailable for the current BASE_URL, global-setup
// writes an empty storageState. Auth-gated specs skip themselves on that
// signal.

const { request: pwRequest } = require('@playwright/test');
const fs   = require('fs');
const path = require('path');

const AUTH_FILE = path.resolve(__dirname, 'playwright/.auth/user.json');

const LOCAL_SEED_EMAIL    = 'test@local.invalid';
const LOCAL_SEED_PASSWORD = 'LocalTestUser_2026!';

function classifyBaseURL(baseURL) {
  if (!baseURL) return 'unknown';
  if (baseURL.includes('localhost') || baseURL.includes('127.0.0.1'))    return 'local';
  if (baseURL.includes('staging.ats.rajasekarselvam.com'))                 return 'staging';
  if (baseURL.includes('ats.rajasekarselvam.com'))                         return 'prod';
  return 'unknown';
}

function resolveCreds(envClass) {
  if (envClass === 'local') {
    return { email: LOCAL_SEED_EMAIL, password: LOCAL_SEED_PASSWORD, source: 'local-seed' };
  }
  if (envClass === 'staging') {
    return {
      email:    process.env.STAGING_E2E_EMAIL    || LOCAL_SEED_EMAIL,
      password: process.env.STAGING_E2E_PASSWORD || LOCAL_SEED_PASSWORD,
      source:   process.env.STAGING_E2E_EMAIL ? 'staging-env' : 'staging-seed-fallback',
    };
  }
  if (envClass === 'prod') {
    if (process.env.PROD_E2E_EMAIL && process.env.PROD_E2E_PASSWORD) {
      return {
        email:    process.env.PROD_E2E_EMAIL,
        password: process.env.PROD_E2E_PASSWORD,
        source:   'prod-env',
      };
    }
    return null;  // no creds available; will skip
  }
  return null;
}

module.exports = async function globalSetup(config) {
  const baseURL = (config.projects[0] && config.projects[0].use && config.projects[0].use.baseURL)
               || process.env.BASE_URL
               || process.env.ATS_BASE_URL
               || 'https://ats.rajasekarselvam.com';
  const envClass = classifyBaseURL(baseURL);
  const creds    = resolveCreds(envClass);

  fs.mkdirSync(path.dirname(AUTH_FILE), { recursive: true });

  if (!creds) {
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }, null, 2));
    if (envClass === 'prod') {
      console.log('[global-setup] PROD detected, no PROD_E2E_EMAIL/PASSWORD set. Auth-gated specs will skip. ' +
        'To enable prod visual smoke, create a synthetic e2e account on prod and set the env vars.');
    } else {
      console.log(`[global-setup] BASE_URL=${baseURL} (${envClass}): no creds resolved, wrote empty storage state.`);
    }
    return;
  }

  const ctx = await pwRequest.newContext({ baseURL, ignoreHTTPSErrors: true });
  try {
    const r = await ctx.post('/api/auth/login', {
      data:    { email: creds.email, password: creds.password },
      headers: { origin: baseURL },
      timeout: 8000,
    });
    if (!r.ok()) {
      const text = await r.text().catch(() => '<no body>');
      throw new Error(`POST /api/auth/login -> ${r.status()}: ${text.slice(0, 200)}`);
    }
    const cookies = await ctx.storageState();
    if (!cookies.cookies || cookies.cookies.length === 0) {
      throw new Error('login succeeded but no cookies stored');
    }
    fs.writeFileSync(AUTH_FILE, JSON.stringify(cookies, null, 2));
    console.log(`[global-setup] ${envClass} login OK (creds source=${creds.source}), wrote ${cookies.cookies.length} cookie(s).`);
  } catch (e) {
    console.warn(`[global-setup] ${envClass} login failed (${e.message}); writing empty storage state.`);
    fs.writeFileSync(AUTH_FILE, JSON.stringify({ cookies: [], origins: [] }, null, 2));
  } finally {
    await ctx.dispose();
  }
};

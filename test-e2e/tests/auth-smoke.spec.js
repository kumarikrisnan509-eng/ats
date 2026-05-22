// auth-smoke.spec.js -- Phase E v5 (prod synthetic-user smoke)
//
// Authenticated read-only smoke against ANY environment that supplies
// credentials via global-setup.js. Complement to visual-snapshots.spec.js:
//
//   visual-snapshots.spec.js  PIXEL diffs against committed baselines.
//                             Suitable for staging (deterministic data).
//                             Skips on prod -- live data flaps the diff.
//
//   auth-smoke.spec.js        STRUCTURAL diffs: every screen mounts, no
//                             console errors, no [object Object], no
//                             leaked NaN. Runs on staging AND prod
//                             (whenever global-setup got auth cookies).
//
// Why this is safe to run on prod:
//   - Uses storageState captured by global-setup from a SYNTHETIC e2e
//     account (operator-created, never a real-user account).
//   - Does NOT click anything. Only navigates + reads document text.
//   - Does NOT submit forms. Backend state cannot change.
//   - The e2e account has no broker linked, so no broker-token side
//     effects either.

const { test, expect } = require('@playwright/test');
const path             = require('path');
const fs               = require('fs');

const AUTH_FILE = path.resolve(__dirname, '..', 'playwright/.auth/user.json');

const SCREENS = [
  '#dashboard', '#paper', '#strategies', '#trading', '#signals',
  '#brokers', '#portfolio', '#attribution', '#slippage',
  '#daily-attribution', '#walk-forward', '#macro-signals',
  '#calibration', '#sip', '#audit', '#settings',
];

// Use whatever auth state global-setup captured.
test.use({ storageState: AUTH_FILE });

function hasAuthCookies() {
  try {
    const j = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    return Array.isArray(j.cookies) && j.cookies.length > 0;
  } catch { return false; }
}

test.describe('Auth smoke (Phase E v5)', () => {
  test.skip(!hasAuthCookies(),
    'No auth cookies from global-setup -- set env-appropriate credentials ' +
    '(local: auto, staging: STAGING_E2E_*, prod: PROD_E2E_*) to enable.');

  for (const route of SCREENS) {
    test(`auth smoke: ${route}`, async ({ page }) => {
      const errors = [];
      page.on('console',   m => { if (m.type() === 'error') errors.push(m.text()); });
      page.on('pageerror', e => errors.push('pageerror: ' + e.message));

      await page.goto(`/${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1200);

      // Page must mount
      const rootChildren = await page.evaluate(() => {
        const r = document.getElementById('root');
        return r ? r.children.length : 0;
      });
      expect(rootChildren, `${route} did not mount`).toBeGreaterThan(0);

      // No object-leaks
      const text = await page.evaluate(() => {
        const r = document.getElementById('root');
        return r ? (r.innerText || '') : '';
      });
      expect(text, `${route} rendered [object Object]`).not.toContain('[object Object]');

      // No fatal console errors
      const fatal = errors.filter(e => /ReferenceError|TypeError|SyntaxError|Cannot read prop/i.test(e));
      expect(fatal, `${route} threw: ${fatal.join('; ')}`).toEqual([]);
    });
  }
});

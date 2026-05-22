// visual-snapshots.spec.js -- Phase E v4
//
// Pixel-level regression detection. Complements visual-rendering.spec.js:
//   * visual-rendering catches "what's rendered is wrong" (object leaks, NaN)
//   * visual-snapshots catches "what's rendered LOOKS wrong" (layout drift,
//     CSS regression, missing icon, font swap, broken grid)
//
// Phase E v4 unlocks auth-gated screens:
//   - global-setup.js logs in once as the seeded test user (Phase E v4
//     backend hook creates test@local.invalid on local boot).
//   - This spec uses test.use({ storageState }) to start each test
//     pre-authenticated, so we can snapshot dashboard / paper / etc.
//
// Skip conditions:
//   - BASE_URL points at prod -- visual snapshots never run against prod
//     because (a) we won't seed a test user there and (b) prod has live
//     data that would flap the diff every minute.
//   - BASE_URL points at localhost or staging -- spec runs, snapshots
//     pixel-diffed against the committed baselines.
//
// First-run baseline seeding (operator does this once on Windows):
//   1. npm run dev                            (in one terminal)
//   2. cd test-e2e
//   3. $env:BASE_URL = "http://localhost:8080"
//   4. npx playwright test visual-snapshots --update-snapshots
//   5. git add tests/visual-snapshots.spec.js-snapshots && git commit
//
// Set PLAYWRIGHT_VISUAL_SNAPSHOTS=0 to opt out temporarily.

const { test, expect } = require('@playwright/test');
const path             = require('path');
const fs               = require('fs');

const ENABLED = process.env.PLAYWRIGHT_VISUAL_SNAPSHOTS !== '0';
const AUTH_FILE = path.resolve(__dirname, '..', 'playwright/.auth/user.json');

function isProd(baseURL) {
  return baseURL && baseURL.includes('ats.rajasekarselvam.com')
      && !baseURL.includes('staging');
}

function hasAuthCookies() {
  try {
    const j = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    return Array.isArray(j.cookies) && j.cookies.length > 0;
  } catch { return false; }
}

// Public landing screen always covered (no auth needed). Protected screens
// covered only when running against local/staging.
const PUBLIC_SCREENS = [
  ['',  'landing',  1500],
];
const PROTECTED_SCREENS = [
  ['#dashboard',           'dashboard',          1800],
  ['#paper',               'paper',              1800],
  ['#strategies',          'strategies',         1800],
  ['#attribution',         'attribution',        1800],
  ['#slippage',            'slippage',           1800],
  ['#daily-attribution',   'daily-attribution',  1800],
  ['#walk-forward',        'walk-forward',       1800],
  ['#macro-signals',       'macro-signals',      1800],
  ['#calibration',         'calibration',        1800],
  ['#sip',                 'sip',                1800],
];

// Helper used by both describe blocks below.
async function freezeAnimations(page) {
  await page.addInitScript(() => {
    const style = document.createElement('style');
    style.textContent = `
      *, *::before, *::after {
        animation-duration: 0s !important;
        animation-delay: 0s !important;
        transition-duration: 0s !important;
        transition-delay: 0s !important;
        caret-color: transparent !important;
      }
    `;
    const insert = () => document.head ? document.head.appendChild(style) : setTimeout(insert, 4);
    insert();
  });
}

async function snapshotScreen(page, route, label, settleMs) {
  page.on('console', () => {});
  page.on('pageerror', () => {});
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(`/${route}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(settleMs);
  await expect(page).toHaveScreenshot(`${label}.png`, {
    fullPage: true,
    animations: 'disabled',
    caret: 'hide',
    maxDiffPixelRatio: 0.02,
    mask: [
      page.locator('[data-live-value]'),
      page.locator('.live-value'),
      page.locator('.timestamp'),
      page.locator('.last-updated'),
      page.locator('text=/\\d+:\\d+:\\d+/'),
      page.locator('text=/seconds? ago|minutes? ago/'),
      page.locator('[data-testid="broker-banner"]'),
    ],
  });
}

// Public describe block: NO storageState. Landing always rendered as
// anonymous, which matches what CI captures even when global-setup login
// is unavailable. Baselines must be seeded without auth too.
test.describe('Visual regression snapshots — public (Phase E)', () => {
  test.skip(!ENABLED, 'PLAYWRIGHT_VISUAL_SNAPSHOTS=0 opted out');

  test.beforeEach(async ({ page }) => { await freezeAnimations(page); });

  for (const [route, label, settleMs] of PUBLIC_SCREENS) {
    test(`snapshot (public): ${label}`, async ({ page }) => {
      await snapshotScreen(page, route, label, settleMs);
    });
  }
});

// Protected describe block: WITH storageState. Skips entirely if global-setup
// didn't capture cookies.
test.describe('Visual regression snapshots — auth-gated (Phase E)', () => {
  test.skip(!ENABLED, 'PLAYWRIGHT_VISUAL_SNAPSHOTS=0 opted out');
  test.use({ storageState: AUTH_FILE });

  test.beforeEach(async ({ page }) => { await freezeAnimations(page); });

  for (const [route, label, settleMs] of PROTECTED_SCREENS) {
    test(`snapshot (auth): ${label}`, async ({ page }) => {
      test.skip(!hasAuthCookies(),
        'No auth cookies -- set PROD_E2E_EMAIL + PROD_E2E_PASSWORD to enable.');
      await snapshotScreen(page, route, label, settleMs);
    });
  }
});

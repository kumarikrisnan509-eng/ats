// prod-readiness.spec.js -- T-349
//
// Locks in three production-readiness invariants in one CI gate:
//
//   1. No FAKE STRATEGY fixtures leak into live mode.
//   2. No FAKE AI SOURCE fixtures leak into live mode.
//   3. No 4xx/5xx response on any /api/* call during route mount.
//
// Background:
//   The session that produced T-330 -> T-348 hunted down ~10 hardcoded-data
//   leaks across 6 screens (risk caps, dashboard donut, signals sources
//   table, paper trade history fixtures, strategy returns heatmap, etc.).
//   Every one was a fake fixture (Momentum AI, Mean Reversion v2, Claude
//   Haiku 4.5, Ensemble v3, ...) that rendered to live users as if it were
//   their real data. Each fix gated the fixture behind window.useDemoMode().
//
//   This spec re-runs the audit on every CI push so the moment any of
//   those fixtures (or new ones with the same NAMES) leak back into a
//   live render, CI fails the deploy.
//
// How to extend:
//   - Add new known-fake names to FAKE_STRATEGY_NAMES or FAKE_AI_SOURCES.
//   - Add new routes to ROUTES if a new screen ships.
//   - Keep the lists SHORT and SPECIFIC -- generic words like "Trend" or
//     "AI" would false-positive on legitimate copy.

const { test, expect } = require('@playwright/test');
const path = require('path');
const fs   = require('fs');

const AUTH_FILE = path.resolve(__dirname, '..', 'playwright/.auth/user.json');

function hasAuthCookies() {
  try {
    const j = JSON.parse(fs.readFileSync(AUTH_FILE, 'utf8'));
    return Array.isArray(j.cookies) && j.cookies.length > 0;
  } catch { return false; }
}

const ROUTES = [
  '#dashboard', '#riskcockpit', '#paper', '#trading', '#strategies', '#signals',
  '#portfolio', '#attribution', '#daily-attribution', '#audit', '#slippage',
  '#macro-signals', '#options-opps', '#calibration', '#walk-forward',
  '#brokers', '#risk', '#riskconfig', '#compliance', '#settings',
  '#ai-keys', '#review', '#sip', '#stpswp', '#longterm', '#money',
];

// Each entry is a SPECIFIC known fixture from the demo / mock data store
// (src/mock-data.jsx and src/trading-modes.jsx). These names must never
// appear in the rendered DOM when demo mode is OFF.
const FAKE_STRATEGY_NAMES = [
  'Momentum AI', 'Mean Reversion v2', 'Iron Condor Weekly', 'Grid Trader',
  'Breakout Scanner', 'MCX Arbitrage', 'Swing Bot', 'NIFTY Futures Trend',
  'Stock Futures Momentum', 'Short Straddle', 'Breakout Scalper',
];

const FAKE_AI_SOURCES = [
  'Claude Haiku 4.5', 'GPT-4o macro', 'Ensemble v3',
];

function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

test.describe('prod-readiness -- zero fake fixtures in live mode (T-349)', () => {
  test.use({ storageState: AUTH_FILE });

  for (const route of ROUTES) {
    test(`route ${route} -- no fake fixtures, no API failures`, async ({ page }) => {
      test.skip(!hasAuthCookies(),
        'No auth cookies in fixture; prod-readiness audit needs login.');

      // Capture genuine API failures (5xx) and unexpected 4xx (excluding
      // documented auth-flow paths). Some endpoints return 401 by design
      // (e.g. /api/csrf-token issues the token AFTER the auth handshake;
      // first call without bearer is a no-op 401). Don't flag those.
      const EXPECTED_4XX_PATHS = [
        '/api/csrf-token',     // auth-flow handshake
        '/api/auth/me',        // returns 401 if cookie not yet attached
        '/api/profile',        // 503/401 when broker token rejected -- T-332 soft-fail
        '/api/orders',         // same -- T-332 soft-fail to brokerConnected:false
      ];
      const apiFailures = [];
      page.on('response', resp => {
        const url = resp.url();
        if (!url.includes('/api/')) return;
        const status = resp.status();
        if (status < 400) return;
        // 429: prod rate-limiter trips during CI's burst traffic. Same allowance
        // the broader e2e suite makes (T-318 sweep added 429 tolerance to all
        // toBe(401) assertions). Real per-route capacity is verified by the
        // dedicated rate-limit spec, not here.
        if (status === 429) return;
        const path = url.replace(/^https?:\/\/[^/]+/, '').split('?')[0];
        const isExpected4xx = status < 500 && EXPECTED_4XX_PATHS.some(p => path === p || path.startsWith(p + '/'));
        if (isExpected4xx) return;
        apiFailures.push(`${status} ${url.replace(/^https?:\/\/[^/]+/, '')}`);
      });

      // Silence noisy console hooks; smoke spec covers console errors.
      page.on('console', () => {});
      page.on('pageerror', () => {});

      await page.goto(`/${route}`, { waitUntil: 'networkidle' });
      // Mount effects + first fetches typically settle in ~1.2s on prod.
      await page.waitForTimeout(1500);

      const text = await page.evaluate(() => /** @type {HTMLElement} */ (document.body).innerText || '');

      // Assertion 1: no fake STRATEGY fixture leaks.
      for (const name of FAKE_STRATEGY_NAMES) {
        const re = new RegExp('\\b' + escapeRe(name) + '\\b');
        if (re.test(text)) {
          throw new Error(`${route}: fake strategy fixture "${name}" appears in live render -- it should be demo-only.`);
        }
      }

      // Assertion 2: no fake AI SOURCE fixture leaks.
      for (const src of FAKE_AI_SOURCES) {
        if (text.includes(src)) {
          throw new Error(`${route}: fake AI source "${src}" appears in live render -- it should be demo-only.`);
        }
      }

      // Assertion 3: every /api/* call returns < 400.
      if (apiFailures.length > 0) {
        throw new Error(`${route}: ${apiFailures.length} API failures during mount:\n  - ` + apiFailures.slice(0, 8).join('\n  - '));
      }
    });
  }
});

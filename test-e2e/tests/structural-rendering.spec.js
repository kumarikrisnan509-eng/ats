// structural-rendering.spec.js -- T-325
//
// REPLACES pixel-diff visual-snapshots.spec.js.
//
// Why this trade.
//   visual-snapshots was a pixel-diff gate over a fullPage screenshot per
//   route. It worked, but every intentional UI change (and several
//   semi-intentional ones — see T-321/T-323/T-324) broke the baselines
//   and required a Linux re-seed cycle. For a solo operator iterating
//   fast on a single-user app, the maintenance load wasn't paying for
//   itself: every bug class that actually shipped in the last week was
//   caught by visual-rendering or smoke, not by pixel diff.
//
// What this spec asserts.
//   For each route the spec knows the contract of, assert the route
//   renders the LABELS / SECTIONS that define its purpose. The contracts
//   are short, written once, and only need updating when the screen's
//   actual user-visible contract changes (e.g. "we renamed REGIME to
//   MARKET MODE"). They survive CSS rework, font swaps, layout drift,
//   colour palette changes, and component restructuring -- by design.
//
//   Generic gates on every route (whether contract-listed or not):
//     1. data-screen-label matches the route's expected title
//     2. ErrorBoundary signature phrase ("Something broke on this screen")
//        is NOT present
//     3. No "[object Object]" leak (overlap with visual-rendering)
//     4. Rendered text length > 80 chars (catches blank fallback)
//
// Auth.
//   Same pattern as visual-rendering / visual-snapshots: opt into
//   storageState from global-setup.js; skip the suite if no auth cookies
//   (PR from a fork without secrets access).

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

// Per-route contracts. Keys are required substrings (case-sensitive). Each
// must appear in the rendered text. Add new entries as you build new screens;
// remove keys only when the user-visible contract really changes.
//
// Contracts left empty/undefined fall through to the generic checks only.
// That's fine for screens we haven't pinned yet -- ErrorBoundary + empty-page
// + screen-label gates still fire.
const ROUTE_CONTRACTS = {
  // Dashboard cockpit -- the home view after login. Verified via Chrome MCP
  // 2026-05-22: label is "Dashboard" (not Cockpit), apostrophes are ASCII.
  '#dashboard': {
    label: 'Dashboard',
    required: ['Welcome back', "TODAY'S PLAN", 'AI INFERENCE', 'PORTFOLIO VALUE'],
  },

  // Risk cockpit -- portfolio aggregates + regime banner + KPIs.
  '#riskcockpit': {
    label: 'Risk cockpit',
    required: ['REGIME:', 'TOTAL VALUE', 'CASH', 'MTM P&L', 'GROSS EXPOSURE', 'LEVERAGE'],
  },

  // Daily attribution -- table of daily PnL rows by strategy + regime.
  '#daily-attribution': {
    label: 'Daily attribution',
    required: ['Daily attribution', 'Total PnL', 'PnL by strategy', 'Daily snapshots'],
  },

  // Same component, route alias under Operations breadcrumb.
  '#attribution': {
    label: 'PnL attribution',
    required: ['Daily attribution', 'Total PnL', 'PnL by strategy'],
  },

  // Audit trail -- SEBI compliance log, even if empty must show the frame.
  // Verified: apostrophe is ASCII (U+0027), not U+2019.
  '#audit': {
    label: 'Order audit trail',
    required: ['Order audit trail', "TODAY'S ORDERS", 'FILL RATE', 'AVG SLIPPAGE', 'RISK BLOCKS'],
  },

  // SIP planner. Title in body uses "+" not "&" (sidebar says "&", header says "+").
  // Apostrophe in "Today's plan" is ASCII.
  '#sip': {
    label: 'SIP plan & history',
    required: ['SIP plan + history', "Today's plan", 'Recent fires'],
  },

  // Slippage tracker -- KPI cards are AVG/TOTAL COST/TRADES TRACKED.
  '#slippage': {
    label: 'Slippage tracker',
    required: ['Slippage tracker', 'AVG SLIPPAGE', 'TOTAL SLIPPAGE COST', 'TRADES TRACKED', 'By strategy', 'By symbol'],
  },

  // Macro signals feed.
  '#macro-signals': {
    label: 'Macro signals',
    required: ['Macro signals', 'Fetcher:', 'Last fetch:'],
  },

  // Options opportunities (shadow scanner). Correct route is #options-opps
  // (the misspelled "opps" is the canonical route key in app.jsx TITLES).
  // Both #options-opportunities and #options-ops fall back to Dashboard.
  '#options-opps': {
    label: 'Options opportunities',
    required: ['Options opportunities', 'Scanner', 'Fetcher', 'Total opportunities'],
  },

  // Strategy calibration (advisory only).
  '#calibration': {
    label: 'Strategy calibration',
    required: ['Strategy calibration', 'advisory only', 'retire', 'watch', 'keep'],
  },

  // Walk-forward optimisation (advisory). Label is "Walk-forward opt" (short).
  '#walk-forward': {
    label: 'Walk-forward opt',
    required: ['Walk-forward optimization', 'Strategy', 'Symbol (NSE)', 'IS window', 'OOS window', 'paramGrid'],
  },
};

// Anonymous landing -- separate describe (no auth needed) so it works even
// when fork PRs skip the rest.
test.describe('structural rendering -- landing (public)', () => {
  test('landing has the marketing surface intact', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });
    await page.waitForTimeout(800);
    const text = await page.evaluate(() => /** @type {HTMLElement} */ (document.body).innerText || '');

    expect(text).toContain('ATS');
    expect(text).toContain('Algo trading');
    expect(text).toContain('Sign in');
    expect(text).not.toContain('Something broke on this screen');
    expect(text).not.toContain('[object Object]');
  });
});

test.describe('structural rendering -- auth-gated', () => {
  test.use({ storageState: AUTH_FILE });

  for (const [route, contract] of Object.entries(ROUTE_CONTRACTS)) {
    test(`route ${route} -- structural contract holds`, async ({ page }) => {
      test.skip(!hasAuthCookies(),
        'No auth cookies in fixture -- structural-rendering would only exercise login.');

      page.on('console', () => {});
      page.on('pageerror', () => {});

      await page.goto(`/${route}`, { waitUntil: 'networkidle' });
      // 1200ms covers our typical fetch-then-render path against prod with
      // cold caches. Same value visual-rendering uses.
      // T-368c: bumped from 1200 to 3500ms. Multi-fetch screens (options-opps,
      // calibration, riskcockpit -- each does 2+ parallel fetches on mount)
      // intermittently failed under CI network latency because their static
      // labels (e.g. "Scanner") only render after `loading=false`. 3500ms
      // covers the slowest screen's load() round-trip on typical CI latency.
      // The proper long-term fix is to render labels eagerly (not gated by
      // loading), but that's a per-screen refactor across many files.
      // T-373: switched from snapshot-based label check (page.evaluate +
      // sleep) to Playwright's auto-retrying locator. The previous snapshot
      // fired before React had mounted the app shell in slow CI runs,
      // yielding `.content` === null -> label=null errors on #riskcockpit
      // and #calibration. Auto-retry polls until the assertion passes OR
      // the timeout expires.

      // 1. data-screen-label matches. 15s timeout covers worst-case CI mount.
      if (contract.label) {
        await expect(page.locator('.content'), `${route} expected label "${contract.label}"`)
          .toHaveAttribute('data-screen-label', contract.label, { timeout: 15000 });
      } else {
        await expect(page.locator('.content'), `${route} .content not present`)
          .toBeAttached({ timeout: 15000 });
      }

      // Read visible text from #root (innerText respects display:none).
      const text = await page.evaluate(() => {
        const root = document.getElementById('root');
        return root ? (/** @type {HTMLElement} */ (root).innerText || '') : '';
      });

      // 2. ErrorBoundary did NOT catch.
      if (text.includes('Something broke on this screen')) {
        const m = text.match(/Something broke on this screen[\s\S]{0,400}/);
        throw new Error(`${route} hit ErrorBoundary. Excerpt:\n${m ? m[0] : '(no detail)'}`);
      }

      // 3. No object leak.
      expect(text, `${route} leaked [object Object]`).not.toContain('[object Object]');

      // 4. Page not blank.
      expect(text.trim().length, `${route} rendered an empty or tiny page (${text.trim().length} chars)`)
        .toBeGreaterThan(80);

      // 5. Per-route required text contract. T-373: locator.toContainText
      // auto-retries each needle individually, handling screens that render
      // static structure first then fill in dynamic text later.
      for (const needle of (contract.required || [])) {
        await expect(page.locator('#root'), `${route} missing required text: "${needle}"`)
          .toContainText(needle, { timeout: 10000 });
      }
    });
  }
});

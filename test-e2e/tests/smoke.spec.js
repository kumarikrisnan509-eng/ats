// smoke.spec.js -- catches blank-page regressions like the Field/SettingsScreen bug.
// Loads each app route and asserts:
//   - #root has children (React mounted)
//   - no console errors fired during render
//   - no uncaught ReferenceError / TypeError

const { test, expect } = require('@playwright/test');

// T-179 (SCREENS-AUDIT followup): updated to match the live app.jsx TITLES map.
//   Removed: #regime, #benchmark, #news -- deleted from the app in T100/v9
//            reduction; the previous spec was silently iterating dead routes.
//   Added:   #modes, #harvest, #money, #compliance, #ai-keys, #goals, #stpswp,
//            #mf, #smallcase, #fixed, #options, #margin, #lab, #review,
//            #insights, #profile -- HIGH/MEDIUM risk screens that had no
//            Playwright assertions per SCREENS-AUDIT.md §6.
const ROUTES = [
  // System / shell
  '#dashboard', '#settings', '#risk', '#compliance', '#profile',
  // Automate
  '#modes', '#strategies', '#signals', '#tuner',
  // Execute
  '#trading', '#audit', '#margin',
  // Validate
  '#paper', '#backtest', '#circuits', '#lab',
  // Wealth / long-term
  '#portfolio', '#stpswp', '#smallcase', '#fixed', '#harvest',
  '#brokers', '#money', '#longterm', '#insights',  // T-248: #mf -> #longterm (ETF baskets)
  // Operations / AI
  '#recon', '#attribution', '#review', '#ai-keys',
];

for (const route of ROUTES) {
  test(`route ${route} renders without console errors`, async ({ page }) => {
    const errors = [];
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));

    await page.goto(`/${route}`, { waitUntil: 'networkidle' });
    // Give React a beat to mount + the route useEffects to fire
    await page.waitForTimeout(800);

    const rootChildren = await page.evaluate(() => document.getElementById('root')?.children?.length || 0);
    expect(rootChildren).toBeGreaterThan(0);

    const fatal = errors.filter(e =>
      /ReferenceError|TypeError|SyntaxError|is not defined|Cannot read prop/i.test(e)
    );
    if (fatal.length) {
      console.error(`[${route}] fatal console errors:\n  ${fatal.join('\n  ')}`);
    }
    expect(fatal, `${route} threw: ${fatal.join('; ')}`).toEqual([]);
  });
}

// T-172: navigate to a hash route so the app shell mounts (the bare `/` route
// serves the marketing landing page, which does NOT include the sidebar nav).
test('app shell sidebar nav renders at #dashboard', async ({ page }) => {
  await page.goto('/#dashboard', { waitUntil: 'networkidle' });
  await page.waitForTimeout(800);
  await expect(page.locator('text=Paper trading').first()).toBeVisible({ timeout: 5000 });
  await expect(page.locator('text=Dashboard').first()).toBeVisible();
});

test('/api/health returns 200', async ({ request }) => {
  const r = await request.get('/api/health');
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(j.ok).toBeTruthy();
});

test('/api/preflight returns shape', async ({ request }) => {
  const r = await request.get('/api/preflight');
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(j).toHaveProperty('checks');
  expect(Array.isArray(j.checks)).toBeTruthy();
});

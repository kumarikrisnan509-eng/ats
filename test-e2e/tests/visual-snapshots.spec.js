// visual-snapshots.spec.js -- Phase E
//
// Pixel-level regression detection. Complements visual-rendering.spec.js:
//   * visual-rendering catches "what's rendered is wrong" (object leaks, NaN)
//   * visual-snapshots catches "what's rendered LOOKS wrong" (layout drift,
//     CSS regression, missing icon, font swap, broken grid)
//
// How it works:
//   First run (no baseline images exist):
//     - Playwright generates baseline PNGs under
//       tests/visual-snapshots.spec.js-snapshots/
//     - The test fails, telling you to commit the baselines.
//     - Run `npx playwright test --update-snapshots visual-snapshots`
//       and commit the resulting files.
//   Subsequent runs:
//     - Playwright takes a fresh screenshot and pixel-compares against the
//       committed baseline. Diff is tolerated up to maxDiffPixelRatio.
//
// Why only 5 screens (not all 32):
//   - Snapshot diffing is fragile against live data (chart series rendered
//     from real prices, "lastUpdated 3 minutes ago" timers, FX moves).
//     We deliberately pick screens whose rendered DOM is dominated by
//     STRUCTURE (cards, tables, grid) rather than LIVE VALUES.
//   - Pixel diffs on 32 screens generate too many false positives. Better to
//     pick 5 high-signal screens whose visual stability matters most.
//
// Bootstrap mode: until baselines are committed, this spec is gated behind
// PLAYWRIGHT_VISUAL_SNAPSHOTS=1. CI default skips it. Operator opts in once
// to seed the baseline, commits the PNGs, then we flip the default.

const { test, expect } = require('@playwright/test');

const ENABLED = !!process.env.PLAYWRIGHT_VISUAL_SNAPSHOTS;

// (route id, friendly name, additional wait for that screen's data to settle)
const VISUAL_SCREENS = [
  ['#dashboard',    'dashboard',    1500],
  ['#paper',        'paper',        1500],
  ['#strategies',   'strategies',   1500],
  ['#attribution',  'attribution',  1500],
  ['#slippage',     'slippage',     1500],
];

test.describe('Visual regression snapshots (Phase E)', () => {
  test.skip(!ENABLED, 'Phase E: set PLAYWRIGHT_VISUAL_SNAPSHOTS=1 to enable. ' +
    'On first enable, run with --update-snapshots to seed baselines.');

  test.beforeEach(async ({ page }) => {
    // Freeze any animation that would cause pixel jitter between runs.
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
      // Insert as early as possible so React renders without transitions.
      const insert = () => document.head ? document.head.appendChild(style) : setTimeout(insert, 4);
      insert();
    });
  });

  for (const [route, label, settleMs] of VISUAL_SCREENS) {
    test(`snapshot: ${label}`, async ({ page }) => {
      // Suppress console; visual-rendering already catches errors.
      page.on('console', () => {});
      page.on('pageerror', () => {});

      // Pin viewport so snapshots are deterministic across CI machines.
      await page.setViewportSize({ width: 1280, height: 800 });

      await page.goto(`/${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(settleMs);

      // Mask live tickers + timestamps so screenshot diffs aren't dominated
      // by them. Any element with [data-live-value] or .timestamp gets
      // covered by a solid block before screenshot.
      await expect(page).toHaveScreenshot(`${label}.png`, {
        fullPage: true,
        animations: 'disabled',
        caret: 'hide',
        // 2% of pixels can differ before failing. Generous because we don't
        // mask every dynamic value yet.
        maxDiffPixelRatio: 0.02,
        // Mask common live elements so timestamps + ticks don't flap the diff.
        mask: [
          page.locator('[data-live-value]'),
          page.locator('.live-value'),
          page.locator('.timestamp'),
          page.locator('.last-updated'),
          page.locator('text=/\\d+:\\d+:\\d+/'),
          page.locator('text=/seconds? ago|minutes? ago/'),
        ],
      });
    });
  }
});

// attribution-fake-pnl.spec.js -- T99-T80 regression guard, updated post-T-311.
// Pre-T-80 the attribution screen showed a hardcoded "+₹1,24,800" net PnL
// even when the user had zero closed trades. T-80 wired the placeholder
// to /api/me/pnl with a "—" fallback. T-311 (this session) REPLACED that
// placeholder with the proper attribution screen wired to
// /api/me/attribution (the canonical endpoint backed by services/
// attribution.js, populated by the daily 16:00 IST snapshot cron).
//
// We assert the live bundled JS no longer contains:
//   - the old hardcoded numbers ("1,24,800", "1,48,600", "11.2%")
// AND we assert the canonical endpoint reference IS present.

const { test, expect } = require('@playwright/test');

test('Attribution screen no longer ships hardcoded ₹1,24,800 PnL (T-80, T-311)', async ({ request }) => {
  const r = await request.get('/src/screen-attribution.js');
  expect(r.ok()).toBeTruthy();
  const js = await r.text();

  // Old hardcoded strings must be absent.
  expect(js).not.toContain('1,24,800');
  expect(js).not.toContain('1,48,600');
  expect(js).not.toContain('11.2%');

  // T-311: canonical attribution endpoint reference must be present.
  // (Replaces the older /api/me/pnl placeholder route that the original
  // T-80 fix used as a stopgap.)
  expect(js).toContain('/api/me/attribution');
});

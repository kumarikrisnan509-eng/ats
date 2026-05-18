// me-endpoints.spec.js -- T99-T71 regression guard.
// Locks in the auth + shape contract for the per-user endpoints added in
// T-67 (/api/me/identity) and T-70 (/api/me/prefs). Both are consumed by
// the Profile screen and LoginHistory widget — silently dropping the auth
// check or changing the response shape would break the UI.
//
// We can't easily test the AUTHED path from CI (no session cookie), so we
// assert:
//   1. Both endpoints return 401 to an unauthed request
//   2. The error body has the expected shape ({ok:false, reason:'auth_required'})
//
// If a future refactor accidentally exposed these endpoints without auth,
// the 401 assertion fails immediately on CI.

const { test, expect } = require('@playwright/test');

const PATHS = ['/api/me/identity', '/api/me/prefs', '/api/me/pnl/monthly', '/api/me/sweep/monthly'];

for (const p of PATHS) {
  test(`${p} requires auth (T-67/T-70)`, async ({ request }) => {
    const r = await request.get(p);
    expect(r.status()).toBe(401);
    const j = await r.json().catch(() => ({}));
    expect(j).toMatchObject({ ok: false });
    expect(j.reason).toBe('auth_required');
  });
}

// T-67 also added /api/me/portfolio/mf + /api/me/portfolio/etf — same auth contract.
test('/api/me/portfolio/mf requires auth (T-66)', async ({ request }) => {
  const r = await request.get('/api/me/portfolio/mf');
  expect(r.status()).toBe(401);
  const j = await r.json().catch(() => ({}));
  expect(j.ok).toBe(false);
});

test('/api/me/portfolio/etf requires auth (T-66)', async ({ request }) => {
  const r = await request.get('/api/me/portfolio/etf');
  expect(r.status()).toBe(401);
});

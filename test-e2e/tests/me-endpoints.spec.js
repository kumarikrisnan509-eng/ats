// me-endpoints.spec.js -- T99-T71 regression guard.
// Locks in the auth + shape contract for the per-user endpoints added in
// T-67 (/api/me/identity) and T-70 (/api/me/prefs). Both are consumed by
// the Profile screen and LoginHistory widget -- silently dropping the auth
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

const PATHS = ['/api/me/identity', '/api/me/prefs', '/api/me/pnl/monthly', '/api/me/sweep/monthly', '/api/me/signals/promotion-rate'];

for (const p of PATHS) {
  test(`${p} requires auth (T-67/T-70)`, async ({ request }) => {
    const r = await request.get(p);
    expect(r.status()).toBe(401);
    const j = await r.json().catch(() => ({}));
    expect(j).toMatchObject({ ok: false });
    expect(j.reason).toBe('auth_required');
  });
}

// T-248: /api/me/portfolio/mf retired (Kite Connect MF API is read-only by SEBI design).
// 410 Gone for ~30 days compat window; no auth check on the stub.
// Tolerates both pre-deploy (401, T-247 backend) and post-deploy (410, T-248+ backend)
// so the spec passes validate BEFORE the deploy fires. Tighten to strict 410 in a
// followup commit after T-248 stabilizes.
test('/api/me/portfolio/mf retired -- 401 (pre-T-248) or 410 (post-T-248)', async ({ request }) => {
  const r = await request.get('/api/me/portfolio/mf');
  expect([401, 410]).toContain(r.status());
  const j = await r.json().catch(() => ({}));
  expect(j.ok).toBe(false);
  if (r.status() === 410) expect(j.reason).toBe('gone');
});

test('/api/me/portfolio/etf requires auth (T-66)', async ({ request }) => {
  const r = await request.get('/api/me/portfolio/etf');
  expect(r.status()).toBe(401);
});

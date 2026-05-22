// obs-middleware.spec.js -- T99-T78 regression guard.
// Locks in that the observability middleware is wired up: every response from
// the public API must carry an x-request-id header so support and ops can
// correlate a user-reported issue to the errors_log row in SQLite.
//
// Before T-78 this header was silently missing (the middleware existed in
// observability.js but app.use(...) was never called).

const { test, expect } = require('@playwright/test');

test('/api/health-deep sets x-request-id header (T-78)', async ({ request }) => {
  const r = await request.get('/api/health-deep');
  expect(r.ok()).toBeTruthy();
  const headers = r.headers();
  // express lowercases header names in fetch-style results
  const reqId = headers['x-request-id'];
  expect(reqId, 'x-request-id should be present').toBeTruthy();
  // 16-char hex from crypto.randomBytes(8).toString('hex')
  expect(reqId).toMatch(/^[0-9a-f]{16}$/);
});

test('/api/auth-mode sets x-request-id header (T-78)', async ({ request }) => {
  const r = await request.get('/api/auth-mode');
  // Phase E v6 followup: rate-limiter may 429 anonymous reads of public
  // endpoints. The x-request-id header should still be set regardless.
  expect([200, 429]).toContain(r.status());
  const reqId = r.headers()['x-request-id'];
  expect(reqId).toMatch(/^[0-9a-f]{16}$/);
});

test('/api/admin/observability returns admin_only or 401 without auth (T-78)', async ({ request }) => {
  // Unauth -> should be 403 admin_only (route is not behind auth wall but
  // checks req.user.is_admin inside the handler).
  const r = await request.get('/api/admin/observability');
  expect([401, 403]).toContain(r.status());
});

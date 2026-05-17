// request-id-error.spec.js -- T99-T79 regression guard.
// Confirms x-request-id is also surfaced on error responses, not just on 2xx.
// This is the property the frontend's window.fetchApi relies on to attach
// .requestId onto thrown Errors so screens can render it next to error
// messages and users can quote it for support.
//
// Hits two endpoints that we know will return non-2xx without auth:
//   /api/admin/observability  -> 401/403 admin_only
//   /api/me/identity          -> 401 auth_required
//
// Both should still have x-request-id (obs middleware runs before auth gates).

const { test, expect } = require('@playwright/test');

test('error response from /api/admin/observability still has x-request-id (T-79)', async ({ request }) => {
  const r = await request.get('/api/admin/observability');
  expect([401, 403]).toContain(r.status());
  const rid = r.headers()['x-request-id'];
  expect(rid, 'x-request-id should be present on error response').toBeTruthy();
  expect(rid).toMatch(/^[0-9a-f]{16}$/);
});

test('error response from /api/me/identity still has x-request-id (T-79)', async ({ request }) => {
  const r = await request.get('/api/me/identity');
  // Without auth this is 401. The obs middleware runs before auth so the
  // response should carry x-request-id even on the auth-fail path.
  expect([401, 403]).toContain(r.status());
  const rid = r.headers()['x-request-id'];
  expect(rid).toMatch(/^[0-9a-f]{16}$/);
});

// ai-trace.spec.js -- T99-T122 (v11-F1) regression guard.
// Locks in the admin-only ai-trace endpoint: unauthenticated callers get 403.

const { test, expect } = require('@playwright/test');

test('/api/admin/ai-trace is admin-gated (T-122)', async ({ request }) => {
  const r = await request.get('/api/admin/ai-trace');
  expect([401, 403]).toContain(r.status());
  const j = await r.json();
  expect(j.ok).toBeFalsy();
  expect(['admin_only', 'auth_required']).toContain(j.reason);
});

test('/api/admin/ai-trace also gated on filter variants (T-122)', async ({ request }) => {
  const r = await request.get('/api/admin/ai-trace?limit=10&status=error');
  expect([401, 403]).toContain(r.status());
});

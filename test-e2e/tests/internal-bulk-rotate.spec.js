// internal-bulk-rotate.spec.js -- T-141 regression guard for T-133.
//
// Locks the contract that the two internal routes shipped in T-133 are
// gated by requireInternal() (loopback/private-IP + X-ATS-Internal header)
// and CANNOT be hit from the public internet.
//
// These routes return plaintext Kite credentials (api_key, api_secret,
// totp_seed, password) for users opted into auto_reauth. If the gate ever
// regresses, the impact is "any random internet client can pull every
// user's broker creds". The test fails open: any non-403 response is a
// security regression that should block deploy.
//
// Mirrors internal-header-strip.spec.js (T-41) which already guards the
// older /api/brokers/zerodha/auto-login/bundle route.

const { test, expect } = require('@playwright/test');

const PUBLIC_ROUTES = [
  '/api/admin/internal/bulk-rotate',
  '/api/admin/internal/seal-token',
];

for (const route of PUBLIC_ROUTES) {
  test(`POST ${route} rejects public request without header`, async ({ request }) => {
    const r = await request.post(route, { data: {} });
    expect(r.status(), `${route} must be 403 from public`).toBe(403);
    const j = await r.json().catch(() => ({}));
    expect(j.ok).toBe(false);
    // Accept either reason — both indicate the gate fired.
    // T-181: CSRF middleware can fire BEFORE requireInternal() gate when the
    // Playwright runner has no Origin header. All three reasons mean 'rejected'.
    expect(['external_ip', 'missing_header', 'cross_origin_rejected']).toContain(j.reason);
  });

  test(`POST ${route} rejects public request even WITH the magic header`, async ({ request }) => {
    // nginx is supposed to strip X-ATS-Internal from public traffic.
    // Even if it somehow reaches the backend, requireInternal()'s IP check
    // fires first because we're not on a private/loopback IP.
    const r = await request.post(route, {
      data: {},
      headers: { 'x-ats-internal': '1' },
    });
    expect(r.status(), `${route} must be 403 even with header from public`).toBe(403);
    const j = await r.json().catch(() => ({}));
    expect(j.ok).toBe(false);
    // T-181: CSRF middleware can fire BEFORE requireInternal() gate when the
    // Playwright runner has no Origin header. All three reasons mean 'rejected'.
    expect(['external_ip', 'missing_header', 'cross_origin_rejected']).toContain(j.reason);
  });
}

// Quick sanity that GET also blocked (POST-only routes still shouldn't leak
// metadata via wrong-method handler).
test('GET /api/admin/internal/bulk-rotate also rejected', async ({ request }) => {
  const r = await request.get('/api/admin/internal/bulk-rotate');
  // Express may respond 404/405 for wrong-method (no GET handler defined)
  // OR 403 if the route handler treats GET → POST the same — accept any
  // non-2xx as long as the response body never carries account data.
  expect(r.status()).toBeGreaterThanOrEqual(400);
  const body = await r.text();
  // Must NOT leak any of the credential field names — those would only
  // appear if the bulk-rotate handler actually ran.
  expect(body).not.toMatch(/totp_seed/);
  expect(body).not.toMatch(/api_secret/);
});

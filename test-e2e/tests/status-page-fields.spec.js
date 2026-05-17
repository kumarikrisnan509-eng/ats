// status-page-fields.spec.js -- T99-T53 regression guard.
// Locks in T-50: /api/status exposes live_data_feed + backups_verified as
// service entries on the public status page. Without this assertion a
// future refactor of _buildStatus() could silently drop them and nobody
// would notice until the next time someone visited /status and wondered
// why those rows disappeared.

const { test, expect } = require('@playwright/test');

test('/api/status exposes T-50 internal signals as services', async ({ request }) => {
  const r = await request.get('/api/status');
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(j).toHaveProperty('services');
  const s = j.services;
  expect(typeof s).toBe('object');

  // T-50 live_data_feed must be present + have ok:boolean.
  expect(s).toHaveProperty('live_data_feed');
  expect(typeof s.live_data_feed.ok).toBe('boolean');
  // state is a human-readable enum-ish string. Always present.
  expect(typeof s.live_data_feed.state).toBe('string');
  expect(s.live_data_feed.state.length).toBeGreaterThan(0);

  // T-50 backups_verified must be present + have ok:boolean.
  expect(s).toHaveProperty('backups_verified');
  expect(typeof s.backups_verified.ok).toBe('boolean');
  // state OR error must be set (one or the other).
  expect(typeof (s.backups_verified.state || s.backups_verified.error)).toBe('string');

  // Existing services that the status.html page also expects.
  for (const k of ['ats_app', 'kite', 'nse_surveillance', 'anthropic', 'openai', 'gemini']) {
    expect(s).toHaveProperty(k);
  }
});

test('/api/status top-level shape unchanged', async ({ request }) => {
  const r = await request.get('/api/status');
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(typeof j.ok).toBe('boolean');
  expect(typeof j.ts).toBe('string');
  // degraded + degraded_services come from _buildStatus' summary block.
  // degraded is a boolean; degraded_services is an array of service keys.
  expect(typeof j.degraded).toBe('boolean');
  expect(Array.isArray(j.degraded_services)).toBeTruthy();
});

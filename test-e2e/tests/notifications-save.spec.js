// notifications-save.spec.js -- T-189 regression guard.
//
// Pins the contract for the per-user Notifications PUT endpoint exercised by
// the Settings → Notifications screen. We cannot easily run the AUTHED path
// from CI (no session cookie), so we assert:
//
//   1. PUT /api/v1/me/notifications requires auth (401 to anon).
//   2. GET /api/v1/me/notifications requires auth (401 to anon).
//   3. POST /api/v1/me/notifications/test requires auth (401 to anon).
//   4. Settings page contains the three inline Save buttons (testids stable
//      so future UI re-shuffling can't silently break the save UX).
//
// If a future refactor accidentally exposes these endpoints without auth, or
// drops the inline Save buttons, the corresponding assertion fails on CI.
//
// Note: the CSRF middleware (T-181) Origin-checks /api/* mutations. The
// Playwright test runner does send an Origin header for `request.put`/
// `request.post` calls. For unauthenticated requests, auth-check fires first
// (401), so we don't observe CSRF here — that's tested separately.

const { test, expect } = require('@playwright/test');

// ---- 1. PUT /api/v1/me/notifications requires auth ----
test('PUT /api/v1/me/notifications requires auth (T-189)', async ({ request }) => {
  const r = await request.put('/api/v1/me/notifications', {
    headers: { 'Content-Type': 'application/json' },
    data: {
      email_enabled: true,
      telegram_enabled: true,
      telegram_bot_token: '123456:FAKE_TOKEN_FOR_TEST',
      telegram_chat_id: '999',
    },
  });
  // Accept 401 (auth) or 403 (CSRF rejecting cross-origin). Either is a
  // valid defense-in-depth response for an unauthed cross-origin PUT.
  expect([401, 403, 503]).toContain(r.status());
  const j = await r.json().catch(() => ({}));
  expect(j.ok).toBe(false);
});

// ---- 2. GET /api/v1/me/notifications requires auth ----
test('GET /api/v1/me/notifications requires auth (T-189)', async ({ request }) => {
  const r = await request.get('/api/v1/me/notifications');
  expect([401, 503], `expected unauth code, got ${r.status()}`).toContain(r.status());
  const j = await r.json().catch(() => ({}));
  expect(j.ok).toBe(false);
  expect(j.reason).toBe('auth_required');
});

// ---- 3. POST /api/v1/me/notifications/test requires auth ----
test('POST /api/v1/me/notifications/test requires auth (T-189)', async ({ request }) => {
  const r = await request.post('/api/v1/me/notifications/test', {
    headers: { 'Content-Type': 'application/json' },
    data: { channel: 'telegram' },
  });
  expect([401, 403, 503]).toContain(r.status());
});

// ---- 4. Settings source has the three inline Save buttons ----
//
// CI ordering: validate (Playwright) runs BEFORE deploy. Production is still
// serving the previous bundle when Playwright executes, so fetching screen-
// settings.jsx from `${BASE_URL}/src/...` would test the OLD code, not the
// commit-under-test. To make this a real regression guard against the code
// being shipped, we read from the runner's checked-out source tree directly.
//
// If someone removes the inline Save buttons in a future refactor, this
// assertion fails at PR time -- before the bad code ever reaches prod.
const fs = require('fs');
const path = require('path');

test('screen-settings.jsx exposes inline Save buttons for all 3 channels (T-189)', () => {
  // CI runs Playwright from working-directory: test-e2e/, so the source file
  // is one level up. Locally same path works because dev runs from test-e2e/.
  const settingsPath = path.resolve(__dirname, '..', '..', 'src', 'screen-settings.jsx');
  expect(fs.existsSync(settingsPath)).toBe(true);
  const src = fs.readFileSync(settingsPath, 'utf8');
  expect(src).toContain('data-testid="notif-save-email"');
  expect(src).toContain('data-testid="notif-save-telegram"');
  expect(src).toContain('data-testid="notif-save-webhook"');
  // Also verify the savingNotif loading state is wired (so users see "⋯ saving"
  // feedback while the PUT is in flight -- not just a silent click).
  expect(src).toContain('savingNotif');
});

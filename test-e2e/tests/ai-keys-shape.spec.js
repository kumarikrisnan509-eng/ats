// ai-keys-shape.spec.js -- T-187 (F-13) refactor safety net.
//
// Locks the external contract for the AI-keys screen so the upcoming
// internal restructure (god-component -> KeyVault + RouterPanel +
// ExperimentsPanel + UsagePanel sub-components) cannot accidentally
// break the surface. Authored against production (commit 7ef50b6 era)
// BEFORE the refactor; if any assertion changes between pre- and
// post-refactor runs, the refactor leaked behavior.
//
// What we assert (all anonymous -- CI has no session cookie):
//   1. GET  /api/me/ai-keys           -> 401 (auth_required shape)
//   2. PUT  /api/me/ai-keys           -> 401
//   3. POST /api/me/ai-keys/test      -> 401
//   4. GET  /api/me/ai-keys/usage     -> 401
//   5. The /#ai-keys hash route mounts in the SPA without throwing fatal
//      JS errors. Anonymous load typically renders the page-header + an
//      empty-state / auth-required surface; we only check there are no
//      ReferenceError / TypeError / SyntaxError on the console.

const { test, expect } = require('@playwright/test');

test.describe('AI keys screen contract (T-187)', () => {
  test('GET /api/me/ai-keys requires auth', async ({ request }) => {
    const r = await request.get('/api/me/ai-keys');
    expect([401, 403, 429, 503], `expected unauth code, got ${r.status()}`).toContain(r.status());
    const j = await r.json().catch(() => ({}));
    expect(j.ok).toBe(false);
    if (j.reason) {
      expect(['auth_required', 'no_session', 'session_expired']).toContain(j.reason);
    }
  });

  test('PUT /api/me/ai-keys requires auth', async ({ request }) => {
    const r = await request.put('/api/me/ai-keys', {
      data: { provider: 'anthropic', apiKey: 'sk-ant-fake-just-to-trigger-auth' },
    });
    // Must be rejected -- 401 (auth) is the expected shape. 400 is acceptable
    // only if the body fails validation before auth runs, but we explicitly
    // forbid 2xx (that would mean an anonymous user could write a key).
    expect([400, 401, 403, 429, 503]).toContain(r.status());
    expect(r.status()).toBeGreaterThanOrEqual(400);
  });

  test('POST /api/me/ai-keys/test requires auth', async ({ request }) => {
    const r = await request.post('/api/me/ai-keys/test', {
      data: { provider: 'anthropic' },
    });
    expect([400, 401, 403, 429, 503]).toContain(r.status());
    expect(r.status()).toBeGreaterThanOrEqual(400);
  });

  test('GET /api/me/ai-keys/usage requires auth', async ({ request }) => {
    const r = await request.get('/api/me/ai-keys/usage');
    // This endpoint historically returns 401 to anons. If it ever starts
    // returning 200 with an empty body, that's a leak of "user exists or not".
    expect([401, 403, 404, 429, 503]).toContain(r.status());
  });

  test('#ai-keys route mounts without fatal JS errors (anonymous)', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('/#ai-keys', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);

    // React mounted -- root has children
    const childCount = await page.evaluate(() =>
      document.getElementById('root')?.children?.length || 0
    );
    expect(childCount).toBeGreaterThan(0);

    // No fatal JS errors. We don't enforce zero console.error output (the
    // anonymous fetch of /api/me/ai-keys produces a 401 the screen logs as a
    // warning), only that no ReferenceError / TypeError / SyntaxError fires.
    const fatal = errors.filter(e =>
      /ReferenceError|TypeError|SyntaxError|is not defined|Cannot read prop/i.test(e)
    );
    expect(fatal, `#ai-keys threw fatal: ${fatal.join('; ')}`).toEqual([]);
  });

  test('window.AiKeysScreen is exported after #ai-keys loads', async ({ page }) => {
    // Guards against the refactor accidentally renaming or removing the
    // top-level export that app.jsx consumes (see app.jsx line 238:
    //   'ai-keys': window.AiKeysScreen ? <window.AiKeysScreen/> : null
    // ).
    await page.goto('/#ai-keys', { waitUntil: 'networkidle' });
    await page.waitForTimeout(1200);
    const hasExport = await page.evaluate(() => typeof window.AiKeysScreen === 'function');
    expect(hasExport).toBe(true);
  });
});

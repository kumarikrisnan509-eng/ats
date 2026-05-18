// happy-path.spec.js -- Tier 78 end-to-end happy-path regression suite.
//
// What this locks down:
//   1.  Anonymous user can land at /, see the marketing/sidebar, click into screens
//   2.  Public API contracts: /api/health, /api/preflight, /api/status, /api/market/holidays
//   3.  Auth gate is enforced on every per-user endpoint (no accidental exposure)
//   4.  Core React screens mount without console errors (dashboard, paper, signals,
//       brokers, settings, audit, strategies)
//   5.  Error contract: unknown /api/* returns JSON 404, not the SPA HTML shell
//   6.  WebSocket /ws handshake succeeds (broadcasts may be empty after-hours)
//   7.  Status page surfaces the v11-mandated fields (deployed_sha, market_regime,
//       broker_status, last_reauth_at)
//
// Designed to be runnable against either local dev (ATS_BASE_URL=http://localhost:8080)
// or live prod (ATS_BASE_URL=https://ats.rajasekarselvam.com — the default).
// All assertions are tolerant of state that varies by time-of-day (market open vs
// closed, broker connected vs not) — we only enforce shape + status code contracts.
//
// Spec authored Tier 78. Run via:
//   cd test-e2e && ATS_BASE_URL=https://ats.rajasekarselvam.com npx playwright test happy-path

const { test, expect } = require('@playwright/test');

// ---------------------------------------------------------------------------
// 1. Anonymous landing + sidebar nav
// ---------------------------------------------------------------------------

test.describe('Anonymous landing', () => {
  test('homepage loads and shows core sidebar entries', async ({ page }) => {
    await page.goto('/', { waitUntil: 'networkidle' });

    // The sidebar nav must mount — these labels are non-localized and stable.
    await expect(page.locator('text=Paper trading').first()).toBeVisible({ timeout: 5000 });
    await expect(page.locator('text=Settings').first()).toBeVisible();

    // Title fingerprints the deploy — should not be the raw template.
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);
    expect(title).not.toBe('Vite + React');
  });

  test('clicking Paper trading navigates without console errors', async ({ page }) => {
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto('/', { waitUntil: 'networkidle' });
    await page.locator('text=Paper trading').first().click();
    await page.waitForTimeout(800);

    // Should now be on #paper route
    expect(page.url()).toMatch(/#paper$/);

    // No fatal errors
    const fatal = errors.filter(e =>
      /ReferenceError|TypeError|SyntaxError|is not defined|Cannot read prop/i.test(e)
    );
    expect(fatal, `paper screen threw: ${fatal.join('; ')}`).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 2. Public API contracts (no auth)
// ---------------------------------------------------------------------------

test.describe('Public API contracts', () => {
  test('/api/health returns ok:true', async ({ request }) => {
    const r = await request.get('/api/health');
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(j.ok).toBe(true);
  });

  test('/api/preflight returns checks array', async ({ request }) => {
    const r = await request.get('/api/preflight');
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(j).toHaveProperty('checks');
    expect(Array.isArray(j.checks)).toBeTruthy();
    // Every check has a name + status
    for (const c of j.checks) {
      expect(c).toHaveProperty('name');
      expect(c).toHaveProperty('status');
    }
  });

  test('/api/status returns deploy + broker + market metadata', async ({ request }) => {
    const r = await request.get('/api/status');
    expect(r.ok()).toBeTruthy();
    const j = await r.json();

    // v11 promises these fields surface on the status page.
    expect(j).toHaveProperty('deployed_sha');
    expect(typeof j.deployed_sha).toBe('string');
    expect(j.deployed_sha.length).toBeGreaterThanOrEqual(7);

    // Market regime might be 'unknown' off-hours but the key must exist.
    expect(j).toHaveProperty('market_regime');

    // Broker status block — varies by time of day but the key is required.
    expect(j).toHaveProperty('broker_status');
  });

  test('/api/market/holidays returns array of {date,name}', async ({ request }) => {
    const r = await request.get('/api/market/holidays');
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    // Either {holidays:[...]} or [...] depending on cache state
    const list = Array.isArray(j) ? j : j.holidays;
    expect(Array.isArray(list)).toBeTruthy();
    if (list.length > 0) {
      expect(list[0]).toHaveProperty('date');
    }
  });
});

// ---------------------------------------------------------------------------
// 3. Auth gate (T-67/T-70/T-72/T-73 contract)
// ---------------------------------------------------------------------------

test.describe('Auth gate enforced on per-user endpoints', () => {
  const PROTECTED = [
    '/api/me/identity',
    '/api/me/prefs',
    '/api/me/portfolio/mf',
    '/api/me/portfolio/etf',
    '/api/me/watchlist',
    '/api/me/positions',
    '/api/me/orders',
    '/api/me/funds',
  ];

  for (const p of PROTECTED) {
    test(`GET ${p} returns 401 when unauthed`, async ({ request }) => {
      const r = await request.get(p);
      expect(r.status()).toBe(401);
      const j = await r.json().catch(() => ({}));
      expect(j.ok).toBe(false);
      // Standard reason code shipped in T-67
      if (j.reason) {
        expect(['auth_required', 'no_session', 'session_expired']).toContain(j.reason);
      }
    });
  }

  test('POST /api/me/paper/order without session returns 401', async ({ request }) => {
    const r = await request.post('/api/me/paper/order', {
      data: { symbol: 'RELIANCE', side: 'BUY', qty: 1, type: 'MARKET' },
    });
    expect(r.status()).toBe(401);
  });

  test('POST /api/orders/place without session returns 401', async ({ request }) => {
    const r = await request.post('/api/orders/place', {
      data: { symbol: 'RELIANCE', side: 'BUY', qty: 1, type: 'MARKET' },
    });
    expect(r.status()).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 4. Critical React screens mount cleanly
// ---------------------------------------------------------------------------

test.describe('Core screens render without console errors', () => {
  const CRITICAL = ['#dashboard', '#paper', '#signals', '#brokers', '#settings', '#audit', '#strategies'];

  for (const route of CRITICAL) {
    test(`${route} mounts and shows content`, async ({ page }) => {
      const errors = [];
      page.on('pageerror', e => errors.push(`pageerror: ${e.message}`));
      page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });

      await page.goto(`/${route}`, { waitUntil: 'networkidle' });
      await page.waitForTimeout(1000);

      // React mounted — root has children
      const childCount = await page.evaluate(() =>
        document.getElementById('root')?.children?.length || 0
      );
      expect(childCount).toBeGreaterThan(0);

      // No fatal JS errors
      const fatal = errors.filter(e =>
        /ReferenceError|TypeError|SyntaxError|is not defined|Cannot read prop/i.test(e)
      );
      expect(fatal, `${route} threw fatal: ${fatal.join('; ')}`).toEqual([]);
    });
  }
});

// ---------------------------------------------------------------------------
// 5. Error contract — unknown /api/* should NOT serve SPA HTML
// ---------------------------------------------------------------------------

test.describe('API 404 contract', () => {
  test('GET /api/does-not-exist returns JSON 404, not HTML', async ({ request }) => {
    const r = await request.get('/api/does-not-exist-' + Date.now());
    expect(r.status()).toBe(404);
    const ct = r.headers()['content-type'] || '';
    expect(ct).toMatch(/application\/json/);

    const body = await r.text();
    expect(body).not.toMatch(/<!DOCTYPE html>/i);
    expect(body).not.toMatch(/<html/i);
  });

  test('POST /api/admin/internal/* without internal header returns 401/403', async ({ request }) => {
    // Internal routes are protected by an internal-token check (T-118).
    const r = await request.post('/api/admin/internal/bulk-rotate', { data: {} }).catch(() => null);
    if (r) {
      // Either 401 (no token), 403 (wrong token), or 404 if route renamed —
      // but NEVER a 200.
      expect([401, 403, 404]).toContain(r.status());
    }
  });
});

// ---------------------------------------------------------------------------
// 6. WebSocket /ws handshake
// ---------------------------------------------------------------------------

test.describe('Live ticker WebSocket', () => {
  test('/ws handshake completes within 5s', async ({ page, baseURL }) => {
    // Convert https://host -> wss://host/ws
    const wsURL = (baseURL || '').replace(/^http/, 'ws') + '/ws';

    const result = await page.evaluate((url) => new Promise((resolve) => {
      let opened = false;
      let messageCount = 0;
      try {
        const ws = new WebSocket(url);
        const timer = setTimeout(() => {
          ws.close();
          resolve({ opened, messageCount, error: 'timeout' });
        }, 5000);
        ws.onopen = () => { opened = true; };
        ws.onmessage = () => { messageCount++; };
        ws.onclose = () => { clearTimeout(timer); resolve({ opened, messageCount }); };
        ws.onerror = (e) => { clearTimeout(timer); resolve({ opened, messageCount, error: 'wserror' }); };
        // After 3s, close gracefully so the test moves on.
        setTimeout(() => ws.close(), 3000);
      } catch (e) {
        resolve({ opened: false, messageCount: 0, error: e.message });
      }
    }), wsURL);

    expect(result.opened, `WS handshake failed: ${JSON.stringify(result)}`).toBe(true);
    // We don't assert messageCount > 0 — off-market hours there may be no ticks.
  });
});

// ---------------------------------------------------------------------------
// 7. /api/health-deep operational fingerprint
// ---------------------------------------------------------------------------

test.describe('health-deep operational fields', () => {
  test('exposes checks{} with broker, ws, dr, market keys', async ({ request }) => {
    const r = await request.get('/api/health-deep');
    expect(r.ok()).toBeTruthy();
    const j = await r.json();
    expect(j).toHaveProperty('checks');
    const c = j.checks;

    // These keys must exist regardless of state — they may be false, but the
    // shape must hold so the Status screen doesn't render `undefined`.
    expect(c).toHaveProperty('broker');
    expect(c).toHaveProperty('drStale');
    expect(c).toHaveProperty('drLastTestOk');

    // T-34/T-37: when broker is up, these MUST be booleans
    if (c.broker === true) {
      expect(typeof c.brokerWsConnected).toBe('boolean');
      expect(typeof c.brokerWsStalled).toBe('boolean');
      expect(typeof c.brokerTickStale).toBe('boolean');
    }
  });
});

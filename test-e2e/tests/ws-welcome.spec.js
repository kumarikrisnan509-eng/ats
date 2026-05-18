// ws-welcome.spec.js -- T-142 regression guard for T-130 / T-131.
//
// The /ws welcome packet now carries {authed, userId, userEmail} so the
// frontend can confirm session recognition on the WS handshake without a
// separate /api/me/identity round-trip (T-130). Tier 75 Phase 2 (T-131)
// also relies on ws.userId being set so per-WS tick filtering picks up
// the user's persisted watchlist.
//
// If a future refactor drops the auth lookup from wss.on('connection'),
// every authed client suddenly sees DEFAULT_SYMBOLS only and the
// "Powered by my own watchlist" UX silently breaks. This spec catches
// that regression by asserting the welcome packet's shape.

const { test, expect } = require('@playwright/test');

function openWs(baseURL, page, opts = {}) {
  const wsURL = (baseURL || '').replace(/^http/, 'ws') + '/ws';
  return page.evaluate(({ url, timeoutMs }) => new Promise((resolve) => {
    let welcome = null;
    let opened = false;
    let error = null;
    try {
      const ws = new WebSocket(url);
      const t = setTimeout(() => {
        try { ws.close(); } catch (_) {}
        resolve({ opened, welcome, error: error || 'timeout' });
      }, timeoutMs || 5000);
      ws.onopen = () => { opened = true; };
      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data);
          if (msg && msg.type === 'welcome') {
            welcome = msg;
            clearTimeout(t);
            try { ws.close(); } catch (_) {}
            resolve({ opened, welcome });
          }
        } catch (_) {}
      };
      ws.onerror = () => { error = 'wserror'; };
      ws.onclose = () => {
        if (!welcome) {
          clearTimeout(t);
          resolve({ opened, welcome: null, error: error || 'closed_before_welcome' });
        }
      };
    } catch (e) {
      resolve({ opened: false, welcome: null, error: e.message });
    }
  }), { url: wsURL, timeoutMs: opts.timeoutMs || 5000 });
}

test('anonymous /ws connection — welcome packet has T-130 auth fields', async ({ page, baseURL }) => {
  const r = await openWs(baseURL, page);
  expect(r.opened, `WS did not open: ${r.error}`).toBe(true);
  expect(r.welcome, 'no welcome packet received').toBeTruthy();

  // T-130 contract: these three keys MUST be present.
  expect(r.welcome).toHaveProperty('authed');
  expect(r.welcome).toHaveProperty('userId');
  expect(r.welcome).toHaveProperty('userEmail');

  // Anonymous connection → authed must be false, userId null.
  expect(r.welcome.authed).toBe(false);
  expect(r.welcome.userId).toBeNull();

  // Pre-existing contract from before T-130 — defensive check that we
  // didn't accidentally drop these while adding the new fields.
  expect(r.welcome).toHaveProperty('symbols');
  expect(Array.isArray(r.welcome.symbols)).toBe(true);
  expect(r.welcome).toHaveProperty('broker');
});

test('bogus cookie /ws connection — HMAC fails, falls back anonymous', async ({ context, page, baseURL }) => {
  // Set a fake ats.sid cookie that won't pass the HMAC check.
  const host = new URL(baseURL).host.split(':')[0];
  await context.addCookies([{
    name: 'ats.sid',
    value: 'totally-fake-session.bogus-mac',
    domain: host,
    path: '/',
    httpOnly: true,
    secure: baseURL.startsWith('https'),
  }]);

  const r = await openWs(baseURL, page);
  expect(r.opened).toBe(true);
  expect(r.welcome).toBeTruthy();
  // HMAC check fails → readSessionCookie returns null → ws.userId stays null
  expect(r.welcome.authed).toBe(false);
  expect(r.welcome.userId).toBeNull();
});

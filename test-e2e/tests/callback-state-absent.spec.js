// callback-state-absent.spec.js -- T99-T63 regression guard.
// Locks in T-58: all three Zerodha callback URLs (/api/brokers/zerodha/callback,
// /api/me/broker-callback, /api/v1/oauth/zerodha/callback) accept requests
// without a state parameter and route them through the global-broker
// exchange flow.
//
// Why this matters: before T-58, the v1 and me callbacks unconditionally
// required state. If the Kite developer dashboard's Redirect URL pointed
// at either of those paths, the host-side morning auto-login would silently
// fail every day with "Invalid or expired state token. Please retry from
// the Brokers screen." This caused brokerWsStalled=true to persist across
// the entire session before we root-caused it via OCR on the failure
// screenshot.
//
// Test sends a request_token but no state, then asserts the response is
// NOT the old error. The actual exchange will fail (since the request_token
// is fake), but the failure path is now the GLOBAL-broker exchange path —
// which means we got past the state-check gate.

const { test, expect } = require('@playwright/test');

const PATHS = [
  '/api/brokers/zerodha/callback',
  '/api/me/broker-callback',
  '/api/v1/oauth/zerodha/callback',
];

for (const p of PATHS) {
  test(`callback ${p} no longer hard-rejects state-absent requests (T-58)`, async ({ request }) => {
    const r = await request.get(p + '?request_token=fake_token_for_test_only');
    const status = r.status();
    const body = await r.text();

    // The OLD bug returned 400 with this exact text. New behavior MUST NOT
    // return that exact error — it should either succeed in the global path
    // (won't, request_token is fake) or fail in the exchange step with a
    // different error.
    expect(body).not.toContain('Invalid or expired state token');

    // Acceptable responses now:
    //   400 'Missing request_token.'           — we sent one, so not this
    //   400 'Not configured for Zerodha.'      — global broker disabled
    //   500 'Zerodha exchange failed: ...'     — Kite rejected fake token (expected)
    //   200/302                                 — exchange somehow worked (won't, fake token)
    // Any non-state-error response means T-58 is intact.
    expect([200, 302, 400, 500].includes(status)).toBeTruthy();
  });
}

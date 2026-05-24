// legacy-gone.test.js -- T-384 (architecture audit followup): contract test
// for routes/legacy-gone.js, the 7-stub module extracted from server.js by
// T-382. Verifies every stub responds with the documented 410 shape so
// future refactors can't accidentally regress the "this is gone forever"
// signal that the frontend relies on to know not to retry.
//
// Run with: npm test (uses node --test, no external deps).

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mountLegacyGoneRoutes } = require('../routes/legacy-gone');

// Minimal Express-shaped stub: records every (method, path, handler)
// registration and lets the test invoke the handler directly. We deliberately
// don't pull in express -- the test is faster + isolated from the broader
// app middleware stack.
function makeAppStub() {
  const routes = [];
  return {
    routes,
    get: (path, handler) => { routes.push({ method: 'GET', path, handler }); },
    post: (path, handler) => { routes.push({ method: 'POST', path, handler }); },
    put: (path, handler) => { routes.push({ method: 'PUT', path, handler }); },
    delete: (path, handler) => { routes.push({ method: 'DELETE', path, handler }); },
  };
}

function makeRes() {
  const res = { statusCode: 200, body: null };
  res.status = (code) => { res.statusCode = code; return res; };
  res.json = (body) => { res.body = body; return res; };
  return res;
}

test('mountLegacyGoneRoutes registers exactly 7 GET routes under /api/me/mf/* + portfolio/mf', () => {
  const app = makeAppStub();
  mountLegacyGoneRoutes(app);
  assert.equal(app.routes.length, 7, 'expected 7 stub routes');
  for (const r of app.routes) {
    assert.equal(r.method, 'GET', `${r.path} should be GET-only (no MF placement was ever supported)`);
  }
  const paths = app.routes.map(r => r.path).sort();
  assert.deepEqual(paths, [
    '/api/me/mf/holdings',
    '/api/me/mf/instruments',
    '/api/me/mf/nav/:code',
    '/api/me/mf/orders',
    '/api/me/mf/search',
    '/api/me/mf/sips',
    '/api/me/portfolio/mf',
  ], 'route set drifted from the documented T-248 retirement list');
});

test('every stub responds with HTTP 410 + reason:gone + endpoint label + detail', () => {
  const app = makeAppStub();
  mountLegacyGoneRoutes(app);
  for (const r of app.routes) {
    const res = makeRes();
    r.handler({}, res);
    assert.equal(res.statusCode, 410, `${r.path} should respond 410 Gone`);
    assert.ok(res.body, `${r.path} should write a JSON body`);
    assert.equal(res.body.ok, false);
    assert.equal(res.body.reason, 'gone');
    assert.ok(typeof res.body.endpoint === 'string' && res.body.endpoint.length > 0,
      `${r.path} should label the endpoint`);
    assert.ok(typeof res.body.detail === 'string' && res.body.detail.length > 40,
      `${r.path} should include a human-readable detail message`);
    // Frontend relies on the keyword "retired" + the suggestion to refresh
    // to render the right empty-state messaging.
    assert.match(res.body.detail, /retired/i, `${r.path} detail must mention retirement`);
  }
});

test('endpoint label matches the route family (search/nav/holdings/sips/orders/instruments/portfolio_mf)', () => {
  const app = makeAppStub();
  mountLegacyGoneRoutes(app);
  // Map: route path -> expected `endpoint` field in the JSON body
  const want = {
    '/api/me/mf/search':      'search',
    '/api/me/mf/nav/:code':   'nav',
    '/api/me/mf/holdings':    'holdings',
    '/api/me/mf/sips':        'sips',
    '/api/me/mf/orders':      'orders',
    '/api/me/mf/instruments': 'instruments',
    '/api/me/portfolio/mf':   'portfolio_mf',
  };
  for (const r of app.routes) {
    const res = makeRes();
    r.handler({}, res);
    assert.equal(res.body.endpoint, want[r.path], `${r.path} mismatched endpoint label`);
  }
});

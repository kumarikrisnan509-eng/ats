// Tier 70: observability unit tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createObservability } = require('../observability');

// Minimal stub db with the _conn API the module uses.
function stubDb() {
  const rows = [];
  return {
    _conn: {
      exec: () => {},
      prepare: (sql) => ({
        run: (...args) => {
          if (/INSERT INTO errors_log/.test(sql)) {
            rows.push({ id: rows.length + 1, args });
          }
        },
        all: (limit) => rows.slice(-limit).reverse(),
      }),
    },
    _rows: rows,
  };
}

test('middleware sets x-request-id header and records latency', async () => {
  const db = stubDb();
  const o = createObservability({ db });
  // Fake req/res
  const req = { method: 'GET', path: '/x', route: { path: '/x' }, originalUrl: '/x' };
  let finishHandler;
  const headers = {};
  const res = {
    setHeader: (k, v) => { headers[k] = v; },
    on: (ev, h) => { if (ev === 'finish') finishHandler = h; },
  };
  await new Promise(r => o.middleware(req, res, r));
  assert.ok(headers['x-request-id']);
  // Simulate a small delay
  await new Promise(r => setTimeout(r, 10));
  finishHandler();
  const snap = o.snapshot();
  const r = snap.routes.find(x => x.key === 'GET /x');
  assert.ok(r);
  assert.ok(r.p99 > 0);
});

test('errorMiddleware logs to db and responds with requestId', () => {
  const db = stubDb();
  const o = createObservability({ db });
  const req = { id: 'req-1', method: 'POST', path: '/api/x', route: { path: '/api/x' }, user: { id: 7 } };
  let captured;
  const res = {
    headersSent: false,
    status: function (s) { this._status = s; return this; },
    json: function (b) { captured = { status: this._status, body: b }; },
  };
  o.errorMiddleware(new Error('boom'), req, res, () => {});
  assert.equal(captured.status, 500);
  assert.equal(captured.body.requestId, 'req-1');
  assert.equal(captured.body.reason, 'internal_error');
  assert.equal(db._rows.length, 1);
  assert.equal(db._rows[0].args[1], 7);   // user_id
  assert.equal(db._rows[0].args[6], 'boom'); // message
});

test('snapshot() returns ordered routes with percentiles', async () => {
  const db = stubDb();
  const o = createObservability({ db });
  const samples = o._internal.samplesByRoute;
  samples.set('GET /a', [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]);
  samples.set('GET /b', [1, 2, 3]);
  const snap = o.snapshot();
  const a = snap.routes.find(r => r.key === 'GET /a');
  assert.equal(a.count, 10);
  assert.ok(a.p50 >= 50 && a.p50 <= 60);
  assert.ok(a.p99 >= 90);
});

test('recentErrors honors limit', () => {
  const db = stubDb();
  const o = createObservability({ db });
  // Insert 3 fake errors
  for (let i = 0; i < 3; i++) {
    o.errorMiddleware(new Error('e' + i), { id: String(i), method: 'GET', path: '/' }, {
      headersSent: true, status() { return this; }, json() {},
    }, () => {});
  }
  const errs = o.recentErrors(10);
  assert.equal(errs.length, 3);
});

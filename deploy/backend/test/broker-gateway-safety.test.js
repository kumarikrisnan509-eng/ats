// T-169 (P0 #2): Broker live-trading safety contract.
//
// Pins the layered safety story for order placement:
//
//   Layer 1 (architectural):
//     BrokerGateway base class does NOT expose placeOrder/cancelOrder/
//     modifyOrder. Only placeDryRun (paper-mode audit) is on the interface.
//
//   Layer 2 (default broker):
//     MockBroker (the default when BROKER env is unset) does NOT implement
//     placeOrder. Calls fall through to a 501 PLACE_ORDER_NOT_IMPLEMENTED
//     response at server.js:4510.
//
//   Layer 3 (concrete adapters):
//     Zerodha/Angel/Dhan adapters DO implement placeOrder. When the operator
//     configures one of these, server.js routes orders through:
//       (a) typeof broker.placeOrder === 'function' check
//       (b) 2FA confirm-before-trade gate (Telegram, 5-min window)
//       (c) kill switch
//       (d) daily-loss cap
//       (e) order rate limiter
//
// This test pins (1), (2), and the COUNT of known live-order call sites in
// server.js. If a future commit adds a new broker.placeOrder() call path,
// the count assertion fails and forces explicit review.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { BrokerGateway } = require('../brokers/gateway');
const { MockBroker } = require('../brokers/mock-broker');

// --- Layer 1: BrokerGateway interface has no order-mutating methods ---

test('Layer 1: BrokerGateway prototype does not expose placeOrder', () => {
  assert.equal(typeof BrokerGateway.prototype.placeOrder, 'undefined',
    'BrokerGateway must not expose placeOrder() -- would enable live trading by default');
});

test('Layer 1: BrokerGateway prototype does not expose cancelOrder', () => {
  assert.equal(typeof BrokerGateway.prototype.cancelOrder, 'undefined');
});

test('Layer 1: BrokerGateway prototype does not expose modifyOrder', () => {
  assert.equal(typeof BrokerGateway.prototype.modifyOrder, 'undefined');
});

test('Layer 1: BrokerGateway prototype DOES expose placeDryRun', () => {
  assert.equal(typeof BrokerGateway.prototype.placeDryRun, 'function',
    'placeDryRun is the only sanctioned order pathway on the gateway');
});

// --- Layer 2: Default broker (MockBroker) is paper-only ---

test('Layer 2: MockBroker does not implement placeOrder', () => {
  const mb = new MockBroker();
  assert.equal(typeof mb.placeOrder, 'undefined',
    'MockBroker is the default -- must stay paper-only');
});

test('Layer 2: MockBroker placeDryRun returns ok+dry-run shape', async () => {
  const mb = new MockBroker();
  const r = await mb.placeDryRun({ symbol: 'NSE:RELIANCE', qty: 1, side: 'BUY' });
  assert.equal(r.ok, true);
  assert.equal(r.mode, 'dry-run');
  assert.ok(r.acceptedAt, 'should include acceptedAt timestamp');
});

// --- Layer 3: server.js has a KNOWN COUNT of live broker.placeOrder calls ---
//
// As of T-169 there are exactly 2 such call sites:
//   - /api/orders/place (post-2FA fall-through)
//   - /api/orders/confirm-2fa/:token (after Telegram confirm)

const KNOWN_PLACE_ORDER_CALL_SITES = 2;

test('Layer 3: server.js has KNOWN_PLACE_ORDER_CALL_SITES live broker.placeOrder calls', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const raw = fs.readFileSync(serverPath, 'utf8');

  // Walk line-by-line. For each line, determine whether the position of any
  // `.placeOrder(` token is BEFORE the start of a `//` line-comment on that
  // line. Skip lines whose first non-whitespace is `//` or `*` (inside block
  // comment).  Skip paper.placeOrder.
  const hits = [];
  const lines = raw.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.replace(/^\s+/, '');
    if (trimmed.startsWith('//') || trimmed.startsWith('*')) continue;

    // Cut the line at first `//` (line comment) -- but only if it's not
    // inside a string literal. Cheap heuristic: count quotes before `//`.
    let codePortion = line;
    const cIdx = line.indexOf('//');
    if (cIdx >= 0) {
      const before = line.slice(0, cIdx);
      const sq = (before.match(/'/g) || []).length;
      const dq = (before.match(/"/g) || []).length;
      const bq = (before.match(/`/g) || []).length;
      if (sq % 2 === 0 && dq % 2 === 0 && bq % 2 === 0) {
        codePortion = before;
      }
    }

    const matches = codePortion.matchAll(/(?<![.\w])([a-zA-Z_$][\w$]*(?:\.[a-zA-Z_$][\w$]*)?)\.placeOrder\s*\(/g);
    for (const m of matches) {
      const callee = m[1];
      if (/(^|\.)paper$/.test(callee)) continue;
      hits.push({ line: i + 1, callee });
    }
  }

  const summary = hits.map(h => '  line ' + h.line + ': ' + h.callee + '.placeOrder(...)').join('\n');
  assert.equal(
    hits.length,
    KNOWN_PLACE_ORDER_CALL_SITES,
    'server.js has ' + hits.length + ' live broker.placeOrder() call(s); expected ' +
    KNOWN_PLACE_ORDER_CALL_SITES + '.\nCall sites found:\n' + summary +
    '\n\nIf you added/removed a live-order code path, update KNOWN_PLACE_ORDER_CALL_SITES.'
  );
});

// --- Layer 4 (T-196): /api/orders/place and /api/orders/cancel are auth-gated ---
//
// CODE-AUDIT C.10 #1 documented that the place/cancel routes had no requireAuth,
// used the process-global broker, and keyed 2FA on broker.userId. T-196 fixed all
// three. This test pins the auth wrapper and the use of pickBroker(req).

test('Layer 4 (T-196): /api/orders/place is wrapped in withAuth', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const raw = fs.readFileSync(serverPath, 'utf8');
  // Expect the literal route definition `withAuth(async (req, res) =>`.
  const placeAuthed = /app\.post\(\s*['"]\/api\/orders\/place['"]\s*,\s*withAuth\(/m.test(raw);
  assert.equal(placeAuthed, true,
    'POST /api/orders/place must be wrapped in withAuth -- live-trading auth gate.');
});

test('Layer 4 (T-196): /api/orders/cancel is wrapped in withAuth', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const raw = fs.readFileSync(serverPath, 'utf8');
  const cancelAuthed = /app\.post\(\s*['"]\/api\/orders\/cancel['"]\s*,\s*withAuth\(/m.test(raw);
  assert.equal(cancelAuthed, true,
    'POST /api/orders/cancel must be wrapped in withAuth -- live-trading auth gate.');
});

test('Layer 4 (T-196): 2FA key is per-user (req.user.id), not process-global broker.userId', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const raw = fs.readFileSync(serverPath, 'utf8');
  // The legacy form `const userId = (broker && broker.userId) || ...` must be gone
  // from within the /api/orders/place handler. Search for it; assert absence.
  const legacyKey = /const userId\s*=\s*\(broker\s*&&\s*broker\.userId\)/m.test(raw);
  assert.equal(legacyKey, false,
    'Process-global broker.userId as 2FA key was replaced with req.user.id in T-196.');
  // And the new form should be present at least once.
  const newKey = /const userId\s*=\s*String\(req\.user\.id\);/m.test(raw);
  assert.equal(newKey, true,
    'Expected `const userId = String(req.user.id);` in the post-T-196 2FA key construction.');
});

test('Layer 4 (T-196): 2FA error path HARD-FAILS instead of silent fallthrough', () => {
  const serverPath = path.join(__dirname, '..', 'server.js');
  const raw = fs.readFileSync(serverPath, 'utf8');
  // Pin the 503/2fa_unavailable response. If a future refactor reverts to silent
  // fallthrough, this assertion fails.
  const hardFail = /reason:\s*['"]2fa_unavailable['"]/m.test(raw);
  assert.equal(hardFail, true,
    'On 2FA system error, /api/orders/place must return 503 2fa_unavailable, not fall through to broker.placeOrder.');
});

// --- Layer 3 supplemental: .env.example must not pre-enable live orders ---

test('Layer 3: .env.example does not pre-enable live orders', () => {
  const envPath = path.join(__dirname, '..', '.env.example');
  if (!fs.existsSync(envPath)) return;
  const env = fs.readFileSync(envPath, 'utf8');
  const liveEnabled = /^LIVE_ORDERS_ENABLED\s*=\s*true/m.test(env);
  assert.equal(liveEnabled, false,
    '.env.example must NOT set LIVE_ORDERS_ENABLED=true');
});

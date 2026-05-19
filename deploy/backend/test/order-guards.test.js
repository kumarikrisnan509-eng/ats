// T-200 (CODE-AUDIT D.9 #1): pre-broker safety-gate invariants on /api/orders/place.
//
// broker-gateway-safety.test.js pins what happens INSIDE the broker layer
// (no placeOrder on BrokerGateway, the count of broker.placeOrder call sites,
// withAuth + per-user 2FA from T-196). This file pins the gates that fire
// BEFORE broker.placeOrder is ever reached — the pre-trade circuit-breakers
// listed in CODE-AUDIT §C.5:
//
//   1. KILL_SWITCH    → 503  reason: KILL_SWITCH_ON
//   2. LIVE_TRADING   → 503  reason: LIVE_TRADING_DISABLED
//   3. order rate     → 429  reason: ORDER_RATE_LIMIT
//   4. notional cap   → 400  reason: NOTIONAL_CAP_EXCEEDED   (per-order ₹ size cap)
//   5. aggregate cap  → 400  reason: AGGREGATE_EXPOSURE_CAP_EXCEEDED
//   6. daily loss     → 503  reason: MAX_DAILY_LOSS_HIT
//
// Each gate must:
//   (a) fire from inside the /api/orders/place handler,
//   (b) audit a specific event,
//   (c) return a specific reason string,
// before any broker.placeOrder call site is reached.
//
// These are source-grep tests in the spirit of broker-gateway-safety.test.js.
// They don't exercise the runtime; they pin invariants by reading server.js
// and asserting the literal strings are present in the place-order handler.
// A future refactor that drops a gate fails CI immediately.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// T-224 (M1.4 piece 6b): the /api/orders/place handler moved from server.js
// to routes/orders.js. The handler body itself is byte-identical except for
// `const broker = getBroker()`-style locals at the top. The 8 source-grep
// assertions still pin the same invariants since they look for audit-event
// strings + reason codes that exist regardless.
const HANDLER_PATH = path.join(__dirname, '..', 'routes', 'orders.js');

// Extract the /api/orders/place handler body once for all assertions.
// Heuristic: from `app.post('/api/orders/place'` line down to the next
// `app.` (route definition for the NEXT route).
function getPlaceOrderHandler() {
  const raw = fs.readFileSync(HANDLER_PATH, 'utf8');
  const startIdx = raw.indexOf("app.post('/api/orders/place'");
  if (startIdx === -1) throw new Error('/api/orders/place route not found in routes/orders.js');
  // Find the next `app.` route definition after this one.
  const afterStart = raw.indexOf('app.', startIdx + 1);
  const endIdx = afterStart === -1 ? raw.length : afterStart;
  return raw.slice(startIdx, endIdx);
}

// Helper: assert a gate fires INSIDE the route handler before any
// `broker.placeOrder` or `pickBroker` call.
function assertGateFiresBeforePlaceOrder(handler, auditEvent, reasonString) {
  const auditIdx = handler.indexOf(auditEvent);
  assert.notEqual(auditIdx, -1,
    `gate audit event '${auditEvent}' must appear in /api/orders/place handler`);

  const reasonIdx = handler.indexOf(reasonString);
  assert.notEqual(reasonIdx, -1,
    `gate reason '${reasonString}' must appear in /api/orders/place handler`);

  // The reason should appear *close to* the audit (within ~250 chars — they're
  // in the same if-block body). This catches a refactor where the reason is
  // dropped but the audit stays.
  assert.ok(Math.abs(reasonIdx - auditIdx) < 500,
    `gate '${reasonString}' must be in the same if-block as audit '${auditEvent}'`);

  // The gate's audit + response must appear BEFORE the ACTUAL placeOrder
  // call (`_p.broker.placeOrder(...)`). Note: several legitimate gates fire
  // AFTER `pickBroker(req)` because they need broker.getHoldings() /
  // getProfile() to compute aggregate exposure or realized P&L for the day.
  // So the strict invariant is: gate must precede the broker call, not the
  // broker resolution.
  const placeOrderIdx = handler.indexOf('_p.broker.placeOrder');
  assert.notEqual(placeOrderIdx, -1,
    'expected `_p.broker.placeOrder` call site in handler (per T-196)');
  assert.ok(auditIdx < placeOrderIdx,
    `gate '${auditEvent}' must fire BEFORE _p.broker.placeOrder(). ` +
    `Found audit at offset ${auditIdx}, broker call at ${placeOrderIdx}.`);
}

// --- Gate 1: KILL_SWITCH ---
test('Gate 1: KILL_SWITCH=true → 503 KILL_SWITCH_ON (no live order routed)', () => {
  const handler = getPlaceOrderHandler();
  assertGateFiresBeforePlaceOrder(handler, "audit('order.blocked.killSwitch'", "'KILL_SWITCH_ON'");

  // Also pin the response status code is 503 (not 200/400).
  const block = handler.slice(handler.indexOf("audit('order.blocked.killSwitch'"));
  assert.ok(/res\.status\(503\)/.test(block.slice(0, 400)),
    'KILL_SWITCH gate must return HTTP 503 (the safety convention for guard rejections)');
});

// --- Gate 2: LIVE_TRADING ---
test('Gate 2: LIVE_TRADING=false → 503 LIVE_TRADING_DISABLED', () => {
  const handler = getPlaceOrderHandler();
  assertGateFiresBeforePlaceOrder(
    handler,
    "audit('order.blocked.liveTradingDisabled'",
    "'LIVE_TRADING_DISABLED'"
  );

  const block = handler.slice(handler.indexOf("audit('order.blocked.liveTradingDisabled'"));
  assert.ok(/res\.status\(503\)/.test(block.slice(0, 400)),
    'LIVE_TRADING gate must return HTTP 503');
});

// --- Gate 3: order rate limit ---
test('Gate 3: per-minute order cap exceeded → 429 ORDER_RATE_LIMIT', () => {
  const handler = getPlaceOrderHandler();
  assertGateFiresBeforePlaceOrder(
    handler,
    "audit('order.blocked.rateLimit'",
    "'ORDER_RATE_LIMIT'"
  );

  // Rate limit uses 429 (Too Many Requests), not 503.
  const block = handler.slice(handler.indexOf("audit('order.blocked.rateLimit'"));
  assert.ok(/res\.status\(429\)/.test(block.slice(0, 400)),
    'rate-limit gate must return HTTP 429 (Too Many Requests)');

  // The helper invocation must be present.
  assert.ok(/_orderRateOk\(\)/.test(handler),
    'rate-limit gate must invoke _orderRateOk() helper from the place-order handler');
});

// --- Gate 4: per-order notional cap (MAX_POSITION_SIZE_INR) ---
test('Gate 4: per-order ₹notional exceeds MAX_POSITION_SIZE_INR → blocked', () => {
  const handler = getPlaceOrderHandler();
  // Reason key in the JSON response.
  assert.ok(/audit\('order\.blocked\.notionalCap'/.test(handler),
    "audit('order.blocked.notionalCap') must fire when orderNotional > MAX_POSITION_SIZE_INR");
  assert.ok(/MAX_POSITION_SIZE_INR/.test(handler),
    "handler must reference MAX_POSITION_SIZE_INR for the per-order ₹ cap check");

  // The gate must fire before the actual broker call.
  const auditIdx = handler.indexOf("audit('order.blocked.notionalCap'");
  const placeOrderIdx = handler.indexOf('_p.broker.placeOrder');
  assert.ok(auditIdx < placeOrderIdx,
    'notional-cap gate must fire BEFORE _p.broker.placeOrder()');
});

// --- Gate 5: aggregate exposure cap (MAX_AGGREGATE_EXPOSURE) ---
test('Gate 5: adding order pushes aggregate exposure > MAX_AGGREGATE_EXPOSURE → blocked', () => {
  const handler = getPlaceOrderHandler();
  assert.ok(/audit\('order\.blocked\.aggregateExposure'/.test(handler),
    "audit('order.blocked.aggregateExposure') must fire when sum exceeds cap");
  assert.ok(/MAX_AGGREGATE_EXPOSURE/.test(handler),
    "handler must reference MAX_AGGREGATE_EXPOSURE for the portfolio-wide cap check");

  const auditIdx = handler.indexOf("audit('order.blocked.aggregateExposure'");
  const placeOrderIdx = handler.indexOf('_p.broker.placeOrder');
  assert.ok(auditIdx < placeOrderIdx,
    'aggregate-exposure gate must fire BEFORE _p.broker.placeOrder() ' +
    '(may fire after pickBroker since it needs holdings to compute exposure)');
});

// --- Gate 6: daily loss cap (MAX_DAILY_LOSS_INR) ---
test('Gate 6: today realizedPnl <= -MAX_DAILY_LOSS_INR → 503 MAX_DAILY_LOSS_HIT', () => {
  const handler = getPlaceOrderHandler();
  assertGateFiresBeforePlaceOrder(
    handler,
    "audit('order.blocked.dailyLoss'",
    "'MAX_DAILY_LOSS_HIT'"
  );

  const block = handler.slice(handler.indexOf("audit('order.blocked.dailyLoss'"));
  assert.ok(/res\.status\(503\)/.test(block.slice(0, 400)),
    'daily-loss gate must return HTTP 503');

  assert.ok(/MAX_DAILY_LOSS_INR/.test(handler),
    "handler must reference MAX_DAILY_LOSS_INR for the today-realized check");
});

// --- Cross-gate invariant: all six gates appear in the documented order ---
test('Gate ordering: kill-switch → live-trading → rate-limit → size → exposure → daily-loss', () => {
  const handler = getPlaceOrderHandler();
  const positions = [
    ['killSwitch',         handler.indexOf("audit('order.blocked.killSwitch'")],
    ['liveTradingDisabled', handler.indexOf("audit('order.blocked.liveTradingDisabled'")],
    ['rateLimit',          handler.indexOf("audit('order.blocked.rateLimit'")],
    ['notionalCap',        handler.indexOf("audit('order.blocked.notionalCap'")],
    ['aggregateExposure',  handler.indexOf("audit('order.blocked.aggregateExposure'")],
    ['dailyLoss',          handler.indexOf("audit('order.blocked.dailyLoss'")],
  ];
  for (const [name, idx] of positions) {
    assert.notEqual(idx, -1, `gate '${name}' audit event not found in handler`);
  }
  for (let i = 1; i < positions.length; i++) {
    assert.ok(positions[i][1] > positions[i - 1][1],
      `gate '${positions[i][0]}' must come AFTER gate '${positions[i - 1][0]}' in the handler. ` +
      `positions: ${JSON.stringify(positions.map(([n, p]) => [n, p]))}`);
  }
});

// --- Sanity: there are still exactly 2 live `broker.placeOrder` call sites overall ---
// (Already pinned by broker-gateway-safety.test.js with KNOWN_PLACE_ORDER_CALL_SITES=2.
// This sanity check just confirms the place-order route still routes through
// pickBroker(req).broker.placeOrder per T-196 -- not a bare global `broker.placeOrder`.)
test('Sanity: /api/orders/place uses pickBroker(req).broker.placeOrder, not bare singleton', () => {
  const handler = getPlaceOrderHandler();
  assert.ok(/_p\.broker\.placeOrder\(/.test(handler),
    'place-order handler must route through the per-user broker (pickBroker result), per T-196.');
  // The bare `broker.placeOrder(` form should NOT appear AS CODE (the global
  // singleton path). Strip line comments before grepping so docs mentioning
  // the old shape don't trip the test.
  const codeOnly = handler.split('\n').map(line => {
    const ci = line.indexOf('//');
    return ci === -1 ? line : line.slice(0, ci);
  }).join('\n');
  const bare = /(?:^|[^.\w])broker\.placeOrder\(/.test(codeOnly);
  assert.equal(bare, false,
    'place-order handler must NOT call `broker.placeOrder` on the module-level singleton ' +
    '(that would re-introduce the T-196 P0: every user\'s order would execute on the operator\'s broker).');
});

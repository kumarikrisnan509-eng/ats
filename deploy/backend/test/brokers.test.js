const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DhanBroker } = require('../brokers/dhan-broker');
const { AngelOneBroker } = require('../brokers/angelone-broker');
const { createBroker } = require('../brokers/index');

test('DhanBroker exposes BrokerGateway surface', () => {
  const b = new DhanBroker();
  assert.equal(b.name, 'dhan');
  // Methods exist
  for (const m of ['start','stop','setAccessToken','health','getProfile','getHoldings','getOrders','getPositions','getMargins','getHistorical','subscribeTicks','ensureSubscribed','placeOrder','cancelOrder']) {
    assert.equal(typeof b[m], 'function', `missing method ${m}`);
  }
});

test('DhanBroker health reflects no token', () => {
  const b = new DhanBroker();
  const h = b.health();
  assert.equal(h.connected, false);
  assert.equal(h.hasAccessToken, false);
  assert.equal(h.name, 'dhan');
});

test('DhanBroker requires token before live calls', async () => {
  const b = new DhanBroker();
  await assert.rejects(b.getHistorical({}), /access token/);
  await assert.rejects(b.placeOrder({}), /access token/);
});

test('AngelOneBroker exposes BrokerGateway surface', () => {
  const b = new AngelOneBroker();
  assert.equal(b.name, 'angelone');
  for (const m of ['start','stop','setAccessToken','health','getProfile','getHoldings','getOrders','getPositions','getMargins','getHistorical','subscribeTicks','ensureSubscribed','placeOrder','cancelOrder']) {
    assert.equal(typeof b[m], 'function', `missing method ${m}`);
  }
});

test('createBroker picks dhan + angelone', () => {
  const d = createBroker({ BROKER: 'dhan' });
  assert.equal(d.name, 'dhan');
  const a1 = createBroker({ BROKER: 'angelone' });
  assert.equal(a1.name, 'angelone');
  const a2 = createBroker({ BROKER: 'angel' });   // alias
  assert.equal(a2.name, 'angelone');
});

test('createBroker rejects unknown', () => {
  assert.throws(() => createBroker({ BROKER: 'fyers' }), /unknown BROKER/);
});

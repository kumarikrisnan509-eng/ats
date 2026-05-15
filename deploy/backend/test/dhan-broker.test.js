const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DhanBroker } = require('../brokers/dhan-broker');

test('constructor: defaults + name', () => {
  const b = new DhanBroker({ accessToken: 'tok', clientId: 'cid' });
  assert.equal(b.name, 'dhan');
  assert.equal(b.accessToken, 'tok');
  assert.equal(b.clientId, 'cid');
});

test('health() before start: not connected', () => {
  const b = new DhanBroker({});
  const h = b.health();
  assert.equal(h.connected, false);
  assert.equal(h.name, 'dhan');
});

test('_requireToken throws when access token missing', async () => {
  const b = new DhanBroker({ clientId: 'c' });
  await assert.rejects(b.getProfile(), /no access token/);
});

test('_requireToken throws when clientId missing', async () => {
  const b = new DhanBroker({ accessToken: 't' });
  await assert.rejects(b.getProfile(), /no client id/);
});

test('loadInstrumentMaster populates symbol -> securityId map', async () => {
  const b = new DhanBroker({ accessToken: 't', clientId: 'c' });
  const r = await b.loadInstrumentMaster([
    { SEM_SMST_SECURITY_ID: '500325', SEM_TRADING_SYMBOL: 'RELIANCE', SEM_EXM_EXCH_ID: 'NSE', SEM_LOT_UNITS: '1' },
    { SEM_SMST_SECURITY_ID: '500180', SEM_TRADING_SYMBOL: 'HDFCBANK', SEM_LOT_UNITS: '1' },
  ]);
  assert.equal(r.count, 2);
  assert.equal(b._symbolToSecurityId.get('RELIANCE'), '500325');
});

test('placeOrder throws cleanly for unknown symbol', async () => {
  const b = new DhanBroker({ accessToken: 't', clientId: 'c' });
  await assert.rejects(
    b.placeOrder({ symbol: 'UNKNOWNXYZ', side: 'BUY', quantity: 1, product: 'CNC', orderType: 'MARKET' }),
    /unknown securityId/
  );
});

test('getHistorical throws cleanly for unknown symbol', async () => {
  const b = new DhanBroker({ accessToken: 't', clientId: 'c' });
  await assert.rejects(b.getHistorical({ symbol: 'NOPE', from: '2026-01-01', to: '2026-01-02' }), /unknown securityId/);
});

test('_normalizeInterval maps ATS interval keys to Dhan keys', () => {
  const b = new DhanBroker({});
  assert.equal(b._normalizeInterval('day'), '1day');
  assert.equal(b._normalizeInterval('60minute'), '60m');
  assert.equal(b._normalizeInterval('5minute'), '5m');
});

test('setAccessToken flips _connected flag', () => {
  const b = new DhanBroker({});
  assert.equal(b._connected, false);
  b.setAccessToken('new-token');
  assert.equal(b._connected, true);
  b.setAccessToken('');
  assert.equal(b._connected, false);
});

test('cancelOrder throws when orderId missing', async () => {
  const b = new DhanBroker({ accessToken: 't', clientId: 'c' });
  await assert.rejects(b.cancelOrder({}), /orderId required/);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AngelOneBroker } = require('../brokers/angelone-broker');

test('constructor: defaults + name', () => {
  const b = new AngelOneBroker({ apiKey: 'k', clientCode: 'c', password: 'p', totpSeed: 's' });
  assert.equal(b.name, 'angelone');
  assert.equal(b.apiKey, 'k');
});

test('health() before login: not connected', () => {
  const b = new AngelOneBroker({});
  const h = b.health();
  assert.equal(h.connected, false);
  assert.equal(h.hasAccessToken, false);
});

test('_requireCreds rejects when API key missing', async () => {
  const b = new AngelOneBroker({ clientCode: 'c', password: 'p', totpSeed: 's' });
  await assert.rejects(b.login(), /ANGEL_API_KEY/);
});
test('_requireCreds rejects when client code missing', async () => {
  const b = new AngelOneBroker({ apiKey: 'k', password: 'p', totpSeed: 's' });
  await assert.rejects(b.login(), /ANGEL_CLIENT_ID/);
});

test('_requireToken rejects REST calls when not logged in', async () => {
  const b = new AngelOneBroker({ apiKey: 'k' });
  await assert.rejects(b.getProfile(), /not logged in/);
});

test('setAccessToken flips _connected', () => {
  const b = new AngelOneBroker({});
  b.setAccessToken('jwt');
  assert.equal(b._connected, true);
  b.setAccessToken('');
  assert.equal(b._connected, false);
});

test('loadInstrumentMaster: token -> symbol mapping', async () => {
  const b = new AngelOneBroker({});
  const r = await b.loadInstrumentMaster([
    { token: '2885', symbol: 'RELIANCE-EQ', exch_seg: 'NSE', lotsize: '1' },
    { token: '1333', symbol: 'HDFCBANK-EQ' },
  ]);
  assert.equal(r.count, 2);
  assert.equal(b._symbolToToken.get('RELIANCE-EQ'), '2885');
});

test('placeOrder throws when symbol unknown', async () => {
  const b = new AngelOneBroker({});
  b.setAccessToken('jwt');
  await assert.rejects(
    b.placeOrder({ symbol: 'NOPE', side: 'BUY', quantity: 1, product: 'INTRADAY', orderType: 'MARKET' }),
    /unknown symboltoken/
  );
});

test('getHistorical throws when symbol unknown', async () => {
  const b = new AngelOneBroker({});
  b.setAccessToken('jwt');
  await assert.rejects(b.getHistorical({ symbol: 'NOPE', from: '2026-01-01', to: '2026-01-02' }), /unknown symboltoken/);
});

test('_normalizeInterval maps to SmartAPI keys', () => {
  const b = new AngelOneBroker({});
  assert.equal(b._normalizeInterval('day'), 'ONE_DAY');
  assert.equal(b._normalizeInterval('15minute'), 'FIFTEEN_MINUTE');
  assert.equal(b._normalizeInterval('5minute'), 'FIVE_MINUTE');
});

test('cancelOrder throws when orderId missing', async () => {
  const b = new AngelOneBroker({});
  b.setAccessToken('jwt');
  await assert.rejects(b.cancelOrder({}), /orderId required/);
});

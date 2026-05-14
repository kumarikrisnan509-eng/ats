const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCsv, normalizeTrade, reconcileCsv } = require('../csv-import');

test('parseCsv handles quoted fields + CRLF', () => {
  const csv = `symbol,quantity,price\r\nRELIANCE,10,"2,950.00"\r\nTCS,5,"4,100.50"\r\n`;
  const rows = parseCsv(csv);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].symbol, 'RELIANCE');
  assert.equal(rows[0].quantity, '10');
  assert.equal(rows[1].symbol, 'TCS');
});

test('parseCsv tolerates escaped quotes', () => {
  const csv = 'name\n"He said ""hi"""\n';
  const rows = parseCsv(csv);
  assert.equal(rows[0].name, 'He said "hi"');
});

test('normalizeTrade extracts symbol/side/qty/price', () => {
  const t = normalizeTrade({ symbol: 'RELIANCE', trade_type: 'buy', quantity: '10', price: '2950', trade_id: 'T1', order_id: 'O1' });
  assert.equal(t.symbol, 'RELIANCE');
  assert.equal(t.side, 'BUY');
  assert.equal(t.qty, 10);
  assert.equal(t.price, 2950);
});

test('normalizeTrade returns null when essential fields missing', () => {
  assert.equal(normalizeTrade({ symbol: '' }), null);
  assert.equal(normalizeTrade({ symbol: 'X', quantity: 'abc' }), null);
});

test('normalizeTrade handles SELL alias', () => {
  const t = normalizeTrade({ symbol: 'TCS', trade_type: 'SELL', quantity: '5', price: '4100' });
  assert.equal(t.side, 'SELL');
});

test('reconcileCsv matches backend orders by (symbol, side, qty)', () => {
  const csv = `symbol,quantity,price,trade_type\nRELIANCE,10,2950,BUY\nTCS,5,4100,SELL\nADANI,20,500,BUY\n`;
  const backendOrders = [
    { id: 'b1', symbol: 'RELIANCE', side: 'BUY',  qty: 10, status: 'FILLED' },
    { id: 'b2', symbol: 'TCS',      side: 'SELL', qty: 5,  status: 'FILLED' },
    { id: 'b3', symbol: 'INFY',     side: 'BUY',  qty: 7,  status: 'FILLED' },
  ];
  const r = reconcileCsv(csv, backendOrders);
  assert.equal(r.parsed, 3);
  assert.equal(r.matched, 2);
  assert.equal(r.onlyInCsv.length, 1);
  assert.equal(r.onlyInCsv[0].symbol, 'ADANI');
  assert.equal(r.onlyInBackend.length, 1);
  assert.equal(r.onlyInBackend[0].symbol, 'INFY');
});

test('reconcileCsv: empty CSV returns clean structure', () => {
  const r = reconcileCsv('', [{ id: 'b1', symbol: 'X', side: 'BUY', qty: 1, status: 'FILLED' }]);
  assert.equal(r.parsed, 0);
  assert.equal(r.matched, 0);
  assert.equal(r.onlyInBackend.length, 1);
});

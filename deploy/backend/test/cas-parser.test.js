const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseCASText, parseAmount } = require('../cas-parser');

test('parseAmount: handles Indian comma format', () => {
  assert.equal(parseAmount('1,23,456.78'), 123456.78);
  assert.equal(parseAmount('₹ 99.99'),    99.99);
  assert.equal(parseAmount('Rs. 1,000'),  1000);
  assert.equal(parseAmount('(123.45)'),   -123.45);
  assert.equal(parseAmount(''),           0);
  assert.equal(parseAmount(null),         0);
});

test('parseCASText: returns error on too-short input', () => {
  const r = parseCASText('hello');
  assert.match(r.error, /too short/);
});

test('parseCASText: extracts PAN', () => {
  const text = 'X'.repeat(200) + '\nPAN: ABCDE1234F\n' + 'Y'.repeat(50);
  const r = parseCASText(text);
  assert.equal(r.pan, 'ABCDE1234F');
});

test('parseCASText: extracts period', () => {
  const text = 'X'.repeat(200) + '\nStatement for the period 01-Apr-2026 to 30-Apr-2026\n';
  const r = parseCASText(text);
  assert.equal(r.period.from, '01-Apr-2026');
  assert.equal(r.period.to,   '30-Apr-2026');
});

test('parseCASText: extracts a single folio + scheme', () => {
  const text = `${'X'.repeat(150)}
HDFC ASSET MANAGEMENT CO LTD
Folio No: 12345678 / 99
HDFC TOP 100 FUND - GROWTH         ISIN: INF179K01YV8       Units: 234.567 NAV: 989.50 Value: 232,134.55 Cost: 200,000.00
${'Y'.repeat(50)}`;
  const r = parseCASText(text);
  assert.equal(r.folios.length, 1);
  assert.equal(r.folios[0].folioNo, '12345678/99');
  assert.equal(r.folios[0].amc, 'HDFC ASSET MANAGEMENT CO LTD');
  assert.equal(r.folios[0].schemes.length, 1);
  const s = r.folios[0].schemes[0];
  assert.equal(s.isin, 'INF179K01YV8');
  assert.equal(s.units, 234.567);
  assert.equal(s.nav, 989.50);
  assert.equal(s.value, 232134.55);
  assert.equal(s.costValue, 200000);
  assert.ok(Math.abs(s.pnl - 32134.55) < 0.01);
});

test('parseCASText: multiple folios across AMCs', () => {
  const text = `${'X'.repeat(150)}
HDFC MUTUAL FUND
Folio No: 11111
SCHEME ONE ISIN: INFAAAAAAAAA Units: 100.000 NAV: 50.00 Value: 5,000.00
ICICI PRUDENTIAL MF
Folio No: 22222
SCHEME TWO ISIN: INFBBBBBBBBB Units: 200.000 NAV: 25.00 Value: 5,000.00`;
  const r = parseCASText(text);
  assert.equal(r.folios.length, 2);
  assert.equal(r.folios[0].amc, 'HDFC MUTUAL FUND');
  assert.equal(r.folios[1].amc, 'ICICI PRUDENTIAL MF');
  assert.equal(r.folios[0].schemes[0].isin, 'INFAAAAAAAAA');
  assert.equal(r.folios[1].schemes[0].isin, 'INFBBBBBBBBB');
});

test('parseCASText: totalValue from header beats summing', () => {
  const text = `${'X'.repeat(150)}
Total Portfolio Value INR 1,00,000.00
HDFC
Folio No: 11
SCHEME ISIN: INFAAAAAAAAA Units: 1.0 NAV: 1.0 Value: 1.00`;
  const r = parseCASText(text);
  assert.equal(r.totalValue, 100000);
});

test('parseCASText: totalValue falls back to summing schemes', () => {
  const text = `${'X'.repeat(150)}
HDFC
Folio No: 11
A ISIN: INFAAAAAAAAA Units: 1.0 NAV: 1.0 Value: 100.00
B ISIN: INFBBBBBBBBB Units: 1.0 NAV: 1.0 Value: 200.50`;
  const r = parseCASText(text);
  assert.equal(r.totalValue, 300.50);
});

test('parseCASText: handles missing cost (returns pnl=0)', () => {
  const text = `${'X'.repeat(150)}
HDFC
Folio No: 11
SCHEME ISIN: INFAAAAAAAAA Units: 1.0 NAV: 1.0 Value: 100.00`;
  const r = parseCASText(text);
  assert.equal(r.folios[0].schemes[0].costValue, 0);
  assert.equal(r.folios[0].schemes[0].pnl, 0);
});

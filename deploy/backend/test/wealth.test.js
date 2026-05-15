const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Wealth } = require('../wealth');

test('bonds catalog has expected shape', () => {
  const w = new Wealth();
  const out = w.getBonds();
  assert.equal(out.ok, true);
  assert.ok(Array.isArray(out.rows));
  assert.ok(out.rows.length >= 8);
  assert.ok(out.disclaimer.includes('Reference data'));
  // every row has the required fields
  for (const r of out.rows) {
    assert.ok(r.type && r.name && r.isin);
    assert.equal(typeof r.yieldPct, 'number');
    assert.equal(typeof r.maturityYears, 'number');
  }
});

test('bonds catalog includes G-Sec and AAA Corp', () => {
  const w = new Wealth();
  const types = new Set(w.getBonds().rows.map(r => r.type));
  assert.ok(types.has('G-Sec'));
  assert.ok(types.has('AAA Corp'));
  assert.ok(types.has('T-Bill'));
});

test('reits returns 4 listed Indian REITs', () => {
  const w = new Wealth();
  const out = w.getReits();
  assert.equal(out.ok, true);
  assert.equal(out.rows.length, 4);
  const syms = new Set(out.rows.map(r => r.sym));
  assert.ok(syms.has('EMBASSY'));
  assert.ok(syms.has('MINDSPACE'));
});

test('smallcases catalog has tier classification', () => {
  const w = new Wealth();
  const rows = w.getSmallcases().rows;
  assert.ok(rows.length >= 4);
  const tiers = new Set(rows.map(r => r.tier));
  assert.ok(tiers.has('low_risk') || tiers.has('core') || tiers.has('thematic'));
});

test('traders is empty by SEBI compliance design', () => {
  const w = new Wealth();
  const out = w.getTraders();
  assert.equal(out.ok, true);
  assert.deepEqual(out.rows, []);
  assert.ok(out.disclaimer.includes('SEBI'));
});

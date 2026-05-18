// sector-map.test.js — T-143 regression guard for T-127.
//
// The 182-symbol SECTOR_MAP is hand-curated and fed directly into the
// critique-rich AI prompt as "Symbol sector: X" context. A typo or wrong
// classification silently degrades AI signal quality across the entire
// scanner output for that symbol.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { SECTOR_MAP, INDEX_SECTOR, sectorOf, isIndex } = require('../sector-map');

test('SECTOR_MAP covers the most-traded NIFTY symbols', () => {
  // High-confidence mappings — these must be correct or AI critique misroutes.
  assert.equal(sectorOf('TCS'), 'IT');
  assert.equal(sectorOf('INFY'), 'IT');
  assert.equal(sectorOf('WIPRO'), 'IT');
  assert.equal(sectorOf('HDFCBANK'), 'Banking');
  assert.equal(sectorOf('ICICIBANK'), 'Banking');
  assert.equal(sectorOf('SBIN'), 'Banking');
  assert.equal(sectorOf('RELIANCE'), 'Energy');
  assert.equal(sectorOf('MARUTI'), 'Auto');
  assert.equal(sectorOf('TATAMOTORS'), 'Auto');
  assert.equal(sectorOf('SUNPHARMA'), 'Pharma');
  assert.equal(sectorOf('HINDUNILVR'), 'FMCG');
  assert.equal(sectorOf('BHARTIARTL'), 'Telecom');
  assert.equal(sectorOf('BAJFINANCE'), 'Financial Services');
});

test('sectorOf is case-insensitive', () => {
  assert.equal(sectorOf('tcs'), 'IT');
  assert.equal(sectorOf('TcS'), 'IT');
  assert.equal(sectorOf(' hdfcbank '), 'Banking');
});

test('sectorOf returns null for unknown symbols (instead of throwing)', () => {
  assert.equal(sectorOf('NONEXISTENTSYMBOL123'), null);
  assert.equal(sectorOf(''), null);
  assert.equal(sectorOf(null), null);
  assert.equal(sectorOf(undefined), null);
});

test('isIndex flags known NSE indices correctly', () => {
  // INDEX_SECTOR keys use the NSE-canonical form with spaces.
  assert.equal(isIndex('NIFTY 50'), true);
  assert.equal(isIndex('NIFTY BANK'), true);
  assert.equal(isIndex('NIFTY IT'), true);
  assert.equal(isIndex('NIFTY FIN SERVICE'), true);
  assert.equal(isIndex('nifty 50'), true);     // case-insensitive
  assert.equal(isIndex('NIFTY 50 '), true);    // whitespace tolerant
  assert.equal(isIndex('TCS'), false);
  assert.equal(isIndex(''), false);
  assert.equal(isIndex(null), false);
  assert.equal(isIndex(undefined), false);
});

test('sectorOf resolves indices to their canonical sector', () => {
  // INDEX_SECTOR exports — index symbols (NSE-canonical form with spaces)
  // should resolve via the merged lookup in sectorOf().
  assert.equal(sectorOf('NIFTY BANK'), 'Banking');
  assert.equal(sectorOf('NIFTY IT'), 'IT');
  assert.equal(sectorOf('NIFTY PHARMA'), 'Pharma');
  assert.equal(sectorOf('NIFTY FIN SERVICE'), 'Financial Services');
});

test('SECTOR_MAP has reasonable coverage (>= 150 symbols)', () => {
  // Sanity gate — if the map shrinks dramatically, something deleted half
  // the file by accident.
  const count = Object.keys(SECTOR_MAP).length;
  assert.ok(count >= 150, `SECTOR_MAP shrunk to ${count} symbols — expected >=150`);
});

test('every SECTOR_MAP value is a string from a closed set', () => {
  // T-127 contract: sectors come from a known set, not arbitrary strings.
  // If someone introduces 'Banks' alongside 'Banking', the AI prompt sees
  // inconsistent values.
  const seen = new Set(Object.values(SECTOR_MAP));
  for (const s of seen) {
    assert.equal(typeof s, 'string', `non-string sector: ${s}`);
    assert.ok(s.length > 0, 'empty-string sector');
    assert.equal(s, s.trim(), `sector has whitespace: "${s}"`);
  }
  // Standard NSE sector classifications + a few derived buckets.
  // Keep this in sync with the actual values in sector-map.js — the test
  // EXISTS to catch drift, so adding 'Foo' here without putting 'Foo' in
  // the map defeats the purpose. Run `node -e "console.log([...new Set(
  // Object.values(require('./sector-map').SECTOR_MAP))].sort())"` to verify.
  const valid = new Set([
    'IT', 'Banking', 'Energy', 'Auto', 'Pharma', 'FMCG', 'Metals',
    'Telecom', 'Consumer', 'Capital Goods', 'Realty', 'Power',
    'Financial Services', 'Media', 'Healthcare', 'Cement',
    'Infrastructure', 'Chemicals', 'Textiles',
    'Conglomerate',           // diversified groups like ITC
  ]);
  for (const s of seen) {
    assert.ok(valid.has(s), `unexpected sector value "${s}" — add to valid set or fix mapping`);
  }
});

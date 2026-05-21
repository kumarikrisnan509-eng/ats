// T-296a CI tests -- option-chain parser + Greeks enrichment + strike picker.
// Mirrors --smoke assertions in services/option-chain.js.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const oc = require('../services/option-chain');

const asOf = new Date('2026-05-21T10:00:00+05:30');
const expiry = new Date(asOf.getTime() + 21 * 24 * 3600 * 1000);
const expiryStr = expiry.toISOString().slice(0, 10);

function makeRaw() {
  const raw = [];
  for (const k of [22500, 23000, 23500, 24000, 24500, 25000, 25500, 26000, 26500]) {
    raw.push({ name: 'NIFTY', segment: 'NFO-OPT', instrument_type: 'CE',
               tradingsymbol: `NIFTY${k}CE`, instrument_token: 1000000 + k,
               strike: k, expiry: expiryStr, lot_size: 75 });
    raw.push({ name: 'NIFTY', segment: 'NFO-OPT', instrument_type: 'PE',
               tradingsymbol: `NIFTY${k}PE`, instrument_token: 2000000 + k,
               strike: k, expiry: expiryStr, lot_size: 75 });
  }
  return raw;
}

test('parseKiteInstruments filters by name and segment', () => {
  const raw = makeRaw();
  raw.push({ name: 'BANKNIFTY', segment: 'NFO-OPT', instrument_type: 'CE',
             tradingsymbol: 'BANK', strike: 45000, expiry: expiryStr, lot_size: 25 });
  const parsed = oc.parseKiteInstruments(raw, 'NIFTY', { asOf });
  assert.ok(parsed.every(p => p.symbol && p.symbol.startsWith('NIFTY')));
  assert.ok(!parsed.some(p => p.symbol && p.symbol.startsWith('BANK')));
});

test('parseKiteInstruments emits {type, strike, expiry, lotSize}', () => {
  const parsed = oc.parseKiteInstruments(makeRaw(), 'NIFTY', { asOf });
  assert.ok(parsed.length > 0);
  for (const row of parsed) {
    assert.ok(row.type === 'call' || row.type === 'put');
    assert.ok(Number.isFinite(row.strike));
    assert.ok(row.expiry);
    assert.equal(row.lotSize, 75);
  }
});

test('enrichWithGreeks adds .greeks {delta,gamma,vega,theta,price}', () => {
  const parsed = oc.parseKiteInstruments(makeRaw(), 'NIFTY', { asOf });
  const enriched = oc.enrichWithGreeks(parsed, {
    spot: 24500, riskFreeRate: 0.07, asOf, assumedIV: 0.15,
  });
  for (const row of enriched) {
    assert.ok(row.greeks, 'greeks present');
    for (const k of ['delta', 'gamma', 'vega', 'theta', 'price']) {
      assert.ok(Number.isFinite(row.greeks[k]), `${k} finite for ${row.symbol}`);
    }
  }
});

test('pickStrikeByDelta picks OTM call closest to target delta', () => {
  const parsed = oc.parseKiteInstruments(makeRaw(), 'NIFTY', { asOf });
  const enriched = oc.enrichWithGreeks(parsed, {
    spot: 24500, riskFreeRate: 0.07, asOf, assumedIV: 0.15,
  });
  const pick = oc.pickStrikeByDelta(enriched, {
    type: 'call', targetDelta: 0.25, expiry: expiryStr,
  });
  assert.ok(pick, 'returned a pick');
  assert.equal(pick.type, 'call');
  assert.ok(pick.strike > 24500, 'OTM call has strike above spot');
  assert.ok(pick.greeks.delta > 0 && pick.greeks.delta < 1);
});

test('pickStrikeByDelta picks OTM put with negative delta', () => {
  const parsed = oc.parseKiteInstruments(makeRaw(), 'NIFTY', { asOf });
  const enriched = oc.enrichWithGreeks(parsed, {
    spot: 24500, riskFreeRate: 0.07, asOf, assumedIV: 0.15,
  });
  const pick = oc.pickStrikeByDelta(enriched, {
    type: 'put', targetDelta: 0.25, expiry: expiryStr,
  });
  assert.ok(pick);
  assert.equal(pick.type, 'put');
  assert.ok(pick.strike < 24500, 'OTM put has strike below spot');
  assert.ok(pick.greeks.delta < 0 && pick.greeks.delta > -1);
});

test('empty input -> empty output (no throws)', () => {
  assert.deepEqual(oc.parseKiteInstruments([], 'NIFTY', { asOf }), []);
  assert.deepEqual(oc.enrichWithGreeks([], { spot: 1, asOf }), []);
});

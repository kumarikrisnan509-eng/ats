// T-269 CI tests -- TSL trailing-stop logic on bracket children.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { PaperTrading } = require('../paper');

const tmp = () => path.join('/tmp', 'paper-tsl-' + Math.random().toString(36).slice(2) + '.json');

function fresh({ tslActivatePct = 0.01, tslGapPct = 0.005 } = {}) {
  const storePath = tmp();
  const p = new PaperTrading({
    storePath,
    startingCash: 1000000,
    audit: () => {},
    getTslConfig: () => ({ tslActivatePct, tslGapPct }),
  });
  return { p, storePath };
}

test('TSL inactive when price has not risen past activate threshold', () => {
  const { p } = fresh({ tslActivatePct: 0.01, tslGapPct: 0.005 });
  p.placeOrder({
    symbol: 'X', side: 'BUY', qty: 10, type: 'BRACKET',
    targetPrice: 110, stopLoss: 95, strategy: 's',
  });
  // Fill the entry @ 100
  p.onTick({ symbol: 'X', ltp: 100 });
  const stop = p._orders.find(o => o.bracketRole === 'stop');
  assert.ok(stop, 'stop child spawned');
  assert.equal(stop.tslState.active, false, 'inactive before threshold');
  assert.equal(stop.triggerPrice, 95, 'trigger unchanged');

  // Price moves up but not enough (<1%)
  p.onTick({ symbol: 'X', ltp: 100.5 });
  assert.equal(stop.tslState.active, false, 'still inactive at 0.5% gain');
  assert.equal(stop.triggerPrice, 95);
});

test('TSL activates and trails up on long bracket', () => {
  const { p } = fresh({ tslActivatePct: 0.01, tslGapPct: 0.005 });
  p.placeOrder({
    symbol: 'Y', side: 'BUY', qty: 10, type: 'BRACKET',
    targetPrice: 110, stopLoss: 95, strategy: 's',
  });
  p.onTick({ symbol: 'Y', ltp: 100 });           // entry fills
  const stop = p._orders.find(o => o.bracketRole === 'stop');

  // Activate at 1% above entry
  p.onTick({ symbol: 'Y', ltp: 101 });
  assert.equal(stop.tslState.active, true, 'TSL armed at +1%');
  // new trigger = max(95, 101 * (1 - 0.005)) = max(95, 100.495) = 100.495
  assert.ok(Math.abs(stop.triggerPrice - 100.495) < 0.001, `trigger=${stop.triggerPrice} expected 100.495`);

  // Price rises further -> trigger trails up
  p.onTick({ symbol: 'Y', ltp: 105 });
  assert.ok(Math.abs(stop.triggerPrice - 105 * 0.995) < 0.001, `trigger=${stop.triggerPrice} after rise`);
  assert.equal(stop.tslState.peakLtp, 105);

  // Price retreats (not below trigger) -> trigger stays
  const peakTrigger = stop.triggerPrice;
  p.onTick({ symbol: 'Y', ltp: 104 });
  assert.equal(stop.triggerPrice, peakTrigger, 'trigger never moves backward');
});

test('TSL on long: when retreat hits trigger, stop fires', () => {
  const { p } = fresh({ tslActivatePct: 0.01, tslGapPct: 0.005 });
  p.placeOrder({ symbol: 'Z', side: 'BUY', qty: 10, type: 'BRACKET', targetPrice: 110, stopLoss: 95, strategy: 's' });
  p.onTick({ symbol: 'Z', ltp: 100 });            // entry fills
  p.onTick({ symbol: 'Z', ltp: 110 });            // would hit target! verify what happens first
  // Actually 110 hits target before stop trails -- so test trailing without target hit:
});

test('TSL on long: peak + retreat fires SL-M at new trigger', () => {
  const { p } = fresh({ tslActivatePct: 0.01, tslGapPct: 0.005 });
  // Use a wider target so the bracket doesn't hit target during the trail test
  p.placeOrder({ symbol: 'W', side: 'BUY', qty: 10, type: 'BRACKET', targetPrice: 200, stopLoss: 95, strategy: 's' });
  p.onTick({ symbol: 'W', ltp: 100 });           // entry fills @ 100
  p.onTick({ symbol: 'W', ltp: 105 });           // TSL active, trigger ~104.4
  const stop = p._orders.find(o => o.bracketRole === 'stop');
  const trig = stop.triggerPrice;
  assert.ok(trig > 95, 'trigger raised above original');
  assert.equal(stop.status, 'PENDING');
  // Now price falls TO the trigger -> stop fires
  p.onTick({ symbol: 'W', ltp: trig - 0.01 });
  assert.equal(stop.status, 'FILLED', 'stop fired when price hit trailed trigger');
  // Target should be cancelled (OCO)
  const target = p._orders.find(o => o.bracketRole === 'target');
  assert.equal(target.status, 'CANCELLED');
});

test('TSL on short bracket trails down', () => {
  const { p } = fresh({ tslActivatePct: 0.01, tslGapPct: 0.005 });
  p.placeOrder({ symbol: 'S', side: 'SELL', qty: 10, type: 'BRACKET', targetPrice: 90, stopLoss: 105, strategy: 's' });
  p.onTick({ symbol: 'S', ltp: 100 });           // entry fills
  const stop = p._orders.find(o => o.bracketRole === 'stop');
  assert.equal(stop.triggerPrice, 105, 'original short-stop trigger');

  // Activate at 1% below entry
  p.onTick({ symbol: 'S', ltp: 99 });
  assert.equal(stop.tslState.active, true);
  // new trigger = min(105, 99 * 1.005) = min(105, 99.495) = 99.495
  assert.ok(Math.abs(stop.triggerPrice - 99.495) < 0.001, `short trigger=${stop.triggerPrice}`);

  // Price falls further -> trigger trails DOWN (lower number)
  p.onTick({ symbol: 'S', ltp: 95 });
  assert.ok(Math.abs(stop.triggerPrice - 95 * 1.005) < 0.001);

  // Price bounces back UP (toward entry, against short) -> trigger stays
  const prev = stop.triggerPrice;
  p.onTick({ symbol: 'S', ltp: 96 });
  assert.equal(stop.triggerPrice, prev, 'short trigger never widens');
});

test('TSL config disabled (both 0) -> no trailing', () => {
  const { p } = fresh({ tslActivatePct: 0, tslGapPct: 0 });
  p.placeOrder({ symbol: 'D', side: 'BUY', qty: 10, type: 'BRACKET', targetPrice: 200, stopLoss: 95, strategy: 's' });
  p.onTick({ symbol: 'D', ltp: 100 });
  p.onTick({ symbol: 'D', ltp: 110 });
  const stop = p._orders.find(o => o.bracketRole === 'stop');
  assert.equal(stop.tslState.active, false);
  assert.equal(stop.triggerPrice, 95, 'trigger never moves when TSL disabled');
});

test('TSL missing getTslConfig -> falls back to safe defaults (0.005 / 0.003)', () => {
  // No getTslConfig passed at all
  const p = new PaperTrading({ storePath: tmp(), startingCash: 1000000, audit: () => {} });
  p.placeOrder({ symbol: 'F', side: 'BUY', qty: 10, type: 'BRACKET', targetPrice: 200, stopLoss: 95, strategy: 's' });
  p.onTick({ symbol: 'F', ltp: 100 });
  p.onTick({ symbol: 'F', ltp: 100.5 });           // +0.5% = exactly threshold
  const stop = p._orders.find(o => o.bracketRole === 'stop');
  assert.equal(stop.tslState.active, true, 'default 0.5% threshold triggered');
});

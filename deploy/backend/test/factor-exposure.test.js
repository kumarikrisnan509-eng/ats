// Tier 69b: factor-exposure unit tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeFactorExposure, _internal } = require('../factor-exposure');

// Build N closes that grow at compounded daily rate r.
function trend(startPx, dailyRet, n) {
  const out = [];
  let px = startPx;
  for (let i = 0; i < n; i++) {
    out.push({ date: '2026-01-' + String(i + 1).padStart(2, '0'), close: px });
    px *= (1 + dailyRet);
  }
  return out;
}

test('returns enoughData=false on no holdings', () => {
  const r = computeFactorExposure({ holdings: [], candlesBySymbol: {} });
  assert.equal(r.enoughData, false);
});

test('returns enoughData=false on zero notional', () => {
  const r = computeFactorExposure({
    holdings: [{ symbol: 'X', qty: 0, ltp: 0 }],
    candlesBySymbol: {},
  });
  assert.equal(r.enoughData, false);
  assert.equal(r.reason, 'zero_notional');
});

test('single holding with ample candles populates all factors', () => {
  const r = computeFactorExposure({
    holdings: [{ symbol: 'A', qty: 100, ltp: 200 }],
    candlesBySymbol: { A: trend(100, 0.001, 260) },
  });
  assert.equal(r.enoughData, true);
  assert.equal(r.holdingCount, 1);
  assert.equal(r.totalNotional, 100 * 200);
  assert.equal(r.perHolding[0].weight, 1);
  assert.ok(r.perHolding[0].momentum1M  > 0);
  assert.ok(r.perHolding[0].momentum3M  > 0);
  assert.ok(r.perHolding[0].momentum12M > 0);
  assert.ok(r.perHolding[0].volatilityAnnual >= 0);
  assert.equal(r.portfolio.momentum12M, r.perHolding[0].momentum12M);
});

test('two holdings 50/50 averages factors weighted', () => {
  const a = trend(100, 0.001, 260);  // ~+30% over 252d
  const b = trend(100, -0.0005, 260); // ~-12% over 252d
  const r = computeFactorExposure({
    holdings: [
      { symbol: 'A', qty: 100, ltp: 100 },
      { symbol: 'B', qty: 100, ltp: 100 },
    ],
    candlesBySymbol: { A: a, B: b },
  });
  assert.equal(r.enoughData, true);
  assert.equal(r.perHolding.length, 2);
  // Portfolio momentum should be roughly midway between A and B
  const expected = 0.5 * r.perHolding[0].momentum12M + 0.5 * r.perHolding[1].momentum12M;
  assert.ok(Math.abs(r.portfolio.momentum12M - expected) < 1e-9);
});

test('concentration warnings fire on top-heavy book', () => {
  const closes = trend(100, 0.0001, 260);
  const r = computeFactorExposure({
    holdings: [
      { symbol: 'A', qty: 1000, ltp: 200 }, // 200k = ~67%
      { symbol: 'B', qty: 100,  ltp: 200 }, // 20k  = ~6.7%
      { symbol: 'C', qty: 100,  ltp: 800 }, // 80k  = ~26.7%
    ],
    candlesBySymbol: { A: closes, B: closes, C: closes },
  });
  assert.ok(r.concentration.top1Weight > 0.5);
  const kinds = r.concentration.warnings.map(w => w.kind);
  assert.ok(kinds.includes('single_stock_over_10'));
});

test('sector aggregation produces sector weights', () => {
  const closes = trend(100, 0.0001, 260);
  const r = computeFactorExposure({
    holdings: [
      { symbol: 'TCS',     qty: 10, ltp: 4000 },
      { symbol: 'INFY',    qty: 10, ltp: 1500 },
      { symbol: 'RELIANCE',qty: 10, ltp: 1300 },
    ],
    candlesBySymbol: { TCS: closes, INFY: closes, RELIANCE: closes },
    sectorMap: { TCS: 'IT', INFY: 'IT', RELIANCE: 'Energy' },
  });
  assert.ok(r.concentration.sectorWeights.IT > 0.5);
  assert.equal(r.concentration.topSector.name, 'IT');
});

test('holdings without candle data still appear with null factors', () => {
  const r = computeFactorExposure({
    holdings: [{ symbol: 'X', qty: 10, ltp: 100 }],
    candlesBySymbol: {},
  });
  assert.equal(r.enoughData, true);
  assert.equal(r.perHolding[0].momentum1M, null);
  assert.equal(r.perHolding[0].momentum3M, null);
  assert.equal(r.perHolding[0].momentum12M, null);
  assert.equal(r.perHolding[0].volatilityAnnual, 0);
});

test('weights sum to ~1 across holdings', () => {
  const closes = trend(100, 0.0001, 260);
  const r = computeFactorExposure({
    holdings: [
      { symbol: 'A', qty: 10, ltp: 100 },
      { symbol: 'B', qty: 20, ltp: 50 },
      { symbol: 'C', qty: 5,  ltp: 200 },
    ],
    candlesBySymbol: { A: closes, B: closes, C: closes },
  });
  const totalWeight = r.perHolding.reduce((s, h) => s + h.weight, 0);
  assert.ok(Math.abs(totalWeight - 1) < 1e-9);
});

test('_internal helpers: stdev / maxDD / windowReturn', () => {
  assert.equal(_internal._stdev([]), 0);
  assert.equal(_internal._maxDDFromCloses([]), 0);
  assert.equal(_internal._windowReturn([100], 21), null);
  assert.equal(_internal._windowReturn([100, 110], 1), 0.1);
});

// Tier 69a: risk-engine unit tests.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeRiskMetrics, _internal } = require('../risk-engine');

// Build N days of equity, starting at startEq, with daily return = ret.
function makeEquity(startEq, dailyRets) {
  let eq = startEq;
  const rows = [{ date: '2026-01-01', equity: startEq }];
  for (let i = 0; i < dailyRets.length; i++) {
    eq = eq * (1 + dailyRets[i]);
    const d = new Date('2026-01-02');
    d.setDate(d.getDate() + i);
    rows.push({ date: d.toISOString().slice(0, 10), equity: eq });
  }
  return rows;
}

test('returns enoughData=false on empty input', () => {
  const r = computeRiskMetrics([]);
  assert.equal(r.enoughData, false);
});

test('returns enoughData=false on single point', () => {
  const r = computeRiskMetrics([{ date: '2026-01-01', equity: 100000 }]);
  assert.equal(r.enoughData, false);
});

test('basic flat equity has zero return, zero vol, no max DD', () => {
  const eq = [
    { date: '2026-01-01', equity: 100000 },
    { date: '2026-01-02', equity: 100000 },
    { date: '2026-01-03', equity: 100000 },
  ];
  const r = computeRiskMetrics(eq);
  assert.equal(r.enoughData, true);
  assert.ok(Math.abs(r.cumulativeReturn) < 1e-9);
  assert.equal(r.volatilityDaily, 0);
  assert.ok(Math.abs(r.maxDrawdown) < 1e-9);
  assert.ok(Math.abs(r.var95Daily) < 1e-9);
});

test('positive trend yields positive cum + annual return', () => {
  const eq = makeEquity(100000, Array(252).fill(0.001)); // +0.1% per day for a year
  const r = computeRiskMetrics(eq);
  assert.ok(r.cumulativeReturn > 0.25, `cumReturn ~28%, got ${r.cumulativeReturn}`);
  assert.ok(r.annualizedReturn > 0.25, `annualReturn should be ~28%, got ${r.annualizedReturn}`);
});

test('max drawdown captures peak-to-trough', () => {
  const rets = [];
  // Climb 5%, then crash 20%, then climb 10%
  for (let i = 0; i < 10; i++) rets.push(0.005);
  for (let i = 0; i < 10; i++) rets.push(-0.02);
  for (let i = 0; i < 10; i++) rets.push(0.005);
  const r = computeRiskMetrics(makeEquity(100000, rets));
  assert.ok(r.maxDrawdown < -0.15, `expected DD < -15%, got ${r.maxDrawdown}`);
  assert.ok(r.maxDrawdownDays >= 9, `DD lasted ~10 days, got ${r.maxDrawdownDays}`);
});

test('historical VaR 95 is positive when there are losses', () => {
  // Mix of +/- 1% returns, evenly distributed
  const rets = [];
  for (let i = 0; i < 100; i++) rets.push((i % 2 === 0 ? 0.01 : -0.01));
  rets.push(-0.05); // tail event
  const r = computeRiskMetrics(makeEquity(100000, rets));
  assert.ok(r.var95Daily > 0, `var95 should be > 0 (a loss), got ${r.var95Daily}`);
  assert.ok(r.cvar95Daily >= r.var95Daily, `CVaR should be >= VaR, got CVaR=${r.cvar95Daily}, VaR=${r.var95Daily}`);
});

test('parametric VaR equals z * vol', () => {
  // 30 days of small returns
  const rets = Array(30).fill(0).map((_, i) => 0.001 * Math.sin(i));
  const r = computeRiskMetrics(makeEquity(100000, rets));
  assert.ok(Math.abs(r.var95Parametric - 1.645 * r.volatilityDaily) < 1e-9);
  assert.ok(Math.abs(r.var99Parametric - 2.326 * r.volatilityDaily) < 1e-9);
});

test('Sharpe ratio is positive when returns exceed risk-free', () => {
  // Average daily return = 0.05% per day = ~12.6% per year, well above 6.5% rf
  const rets = Array(252).fill(0.0005);
  const r = computeRiskMetrics(makeEquity(100000, rets));
  // With zero vol Sharpe is null; perturb each return slightly
  const rets2 = rets.map((x, i) => x + (i % 2 === 0 ? 0.0001 : -0.0001));
  const r2 = computeRiskMetrics(makeEquity(100000, rets2));
  assert.ok(r2.sharpeRatio > 0, `Sharpe should be positive, got ${r2.sharpeRatio}`);
});

test('Sortino >= Sharpe when there are losses', () => {
  // Returns with mostly upside but some big losses
  const rets = [];
  for (let i = 0; i < 100; i++) rets.push(0.002);
  for (let i = 0; i < 10; i++) rets.push(-0.01);
  const r = computeRiskMetrics(makeEquity(100000, rets));
  if (r.sharpeRatio != null && r.sortinoRatio != null) {
    // Sortino should be >= Sharpe because downside-only vol is smaller than full vol
    assert.ok(r.sortinoRatio >= r.sharpeRatio, `Sortino ${r.sortinoRatio} should be >= Sharpe ${r.sharpeRatio}`);
  }
});

test('Calmar = annualReturn / |maxDrawdown|', () => {
  const rets = [];
  for (let i = 0; i < 200; i++) rets.push(0.001);
  for (let i = 0; i < 10; i++) rets.push(-0.01);
  const r = computeRiskMetrics(makeEquity(100000, rets));
  if (r.calmarRatio != null) {
    const expected = r.annualizedReturn / Math.abs(r.maxDrawdown);
    assert.ok(Math.abs(r.calmarRatio - expected) < 1e-9);
  }
});

test('input is sorted by date ascending', () => {
  const out = _internal._clean([
    { date: '2026-03-15', equity: 200 },
    { date: '2026-01-01', equity: 100 },
    { date: '2026-02-01', equity: 150 },
  ]);
  assert.equal(out[0].date, '2026-01-01');
  assert.equal(out[2].date, '2026-03-15');
});

test('non-numeric / missing equity rows are filtered out', () => {
  const out = _internal._clean([
    { date: '2026-01-01', equity: 100 },
    { date: '2026-01-02', equity: 'invalid' },
    { date: '2026-01-03' },
    null,
    { date: '2026-01-04', equity: 110 },
  ]);
  assert.equal(out.length, 2);
  assert.equal(out[0].equity, 100);
  assert.equal(out[1].equity, 110);
});

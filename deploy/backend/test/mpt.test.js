const { test } = require('node:test');
const assert = require('node:assert/strict');
const { MPT } = require('../mpt');

test('rejects fewer than 2 symbols', () => {
  const m = new MPT();
  assert.throws(() => m.optimize({ symbols: ['A'], expectedReturns: [0.1], covMatrix: [[0.01]] }), />= 2 symbols/);
});

test('rejects mismatched covMatrix dims', () => {
  const m = new MPT();
  assert.throws(() => m.optimize({
    symbols: ['A','B'],
    expectedReturns: [0.1, 0.12],
    covMatrix: [[0.01, 0.002]],   // only 1 row instead of 2
  }), /dims mismatch/);
});

test('2-asset case: returns valid weights summing to 1', () => {
  const m = new MPT();
  const out = m.optimize({
    symbols: ['NIFTYBEES', 'GOLDBEES'],
    expectedReturns: [0.12, 0.08],
    covMatrix: [[0.04, 0.002], [0.002, 0.02]],
    samples: 5000,
  });
  assert.equal(out.ok, true);
  const ms = out.maxSharpe;
  const mv = out.minVariance;
  // weights sum to 1
  const sum = (a) => a.reduce((s, v) => s + v, 0);
  assert.ok(Math.abs(sum(ms.weights) - 1) < 0.01, 'maxSharpe sums to ~1');
  assert.ok(Math.abs(sum(mv.weights) - 1) < 0.01, 'minVariance sums to ~1');
  // weights all >= 0
  assert.ok(ms.weights.every(w => w >= 0));
  assert.ok(mv.weights.every(w => w >= 0));
  // maxSharpe sharpe >= minVariance sharpe (typically)
  assert.ok(ms.sharpe >= mv.sharpe - 0.1);
});

test('3-asset diversification: minVariance vol lower than equal-weight', () => {
  const m = new MPT();
  const out = m.optimize({
    symbols: ['EQUITY', 'GOLD', 'BOND'],
    expectedReturns: [0.14, 0.08, 0.07],
    covMatrix: [
      [0.04,  0.002, 0.001],
      [0.002, 0.02,  0.001],
      [0.001, 0.001, 0.005],
    ],
    samples: 10000,
  });
  // The bond-heavy minVariance portfolio should be < 0.15 std-dev
  assert.ok(out.minVariance.volatility < 0.15);
  // Frontier should have multiple points
  assert.ok(out.frontier.length >= 5);
});

test('frontier weights are monotone-ish by return', () => {
  const m = new MPT();
  const out = m.optimize({
    symbols: ['A','B','C'],
    expectedReturns: [0.15, 0.10, 0.06],
    covMatrix: [[0.04,0,0],[0,0.02,0],[0,0,0.005]],
    samples: 10000,
  });
  // Each frontier point should have higher vol than the min-variance
  for (const f of out.frontier) {
    assert.ok(f.volatility >= out.minVariance.volatility - 0.01);
  }
});

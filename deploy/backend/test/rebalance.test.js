const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Rebalance } = require('../rebalance');

test('returns empty when no capital', () => {
  const r = new Rebalance();
  const out = r.suggest({ buckets: { emergency: 20, shortTerm: 30, longTerm: 50 }, holdingsValueINR: 0, paperEquityINR: 0, cashINR: 0 });
  assert.equal(out.total, 0);
  assert.equal(out.suggestions.length, 0);
});

test('balanced allocation -> no suggestions', () => {
  const r = new Rebalance();
  // Total ₹10L; 20% emergency (₹2L cash), 30% short (₹3L paper), 50% long (₹5L holdings)
  const out = r.suggest({
    buckets: { emergency: 20, shortTerm: 30, longTerm: 50 },
    holdingsValueINR: 500000, paperEquityINR: 300000, cashINR: 200000,
  });
  assert.equal(out.triggered, false);
  assert.equal(out.suggestions.length, 0);
});

test('long-term overweight -> suggest DECREASE longTerm + INCREASE others', () => {
  const r = new Rebalance();
  // 100% holdings, 0 paper, 0 cash, targets 20/30/50
  const out = r.suggest({
    buckets: { emergency: 20, shortTerm: 30, longTerm: 50 },
    holdingsValueINR: 1000000, paperEquityINR: 0, cashINR: 0,
  });
  assert.equal(out.triggered, true);
  const longTermSuggestion = out.suggestions.find(s => s.bucket === 'longTerm');
  assert.equal(longTermSuggestion.action, 'DECREASE');
  assert.ok(longTermSuggestion.amountINR > 400000);
});

test('threshold customisation', () => {
  const r = new Rebalance();
  // 4% drift on each side -- should NOT trigger at threshold 5
  const out = r.suggest({
    buckets: { emergency: 20, shortTerm: 30, longTerm: 50 },
    holdingsValueINR: 540000, paperEquityINR: 270000, cashINR: 190000,
    thresholdPct: 5,
  });
  assert.ok(Math.abs(out.drift.longTerm) < 5);
  // Below noise floor (< 1000 INR moves) -> empty suggestions
});

test('drift sums to ~0', () => {
  const r = new Rebalance();
  const out = r.suggest({
    buckets: { emergency: 30, shortTerm: 30, longTerm: 40 },
    holdingsValueINR: 800000, paperEquityINR: 100000, cashINR: 100000,
  });
  const driftSum = out.drift.emergency + out.drift.shortTerm + out.drift.longTerm;
  assert.ok(Math.abs(driftSum) < 0.5);
});

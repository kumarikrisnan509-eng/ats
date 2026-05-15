const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const { LongTerm } = require('../longterm');

const tmp = () => path.join('/tmp', 'longterm-test-' + Math.random().toString(36).slice(2) + '.json');

test('setSips validates + persists', () => {
  const lt = new LongTerm({ storePath: tmp() });
  const sips = lt.setSips([
    { name: 'NIFTYBEES monthly', symbol: 'NIFTYBEES', frequency: 'monthly', amountINR: 10000, enabled: true },
  ]);
  assert.equal(sips.length, 1);
  assert.equal(sips[0].amountINR, 10000);
  assert.equal(sips[0].enabled, true);
  assert.ok(sips[0].id);
});

test('setBuckets rejects sum > 100', () => {
  const lt = new LongTerm({ storePath: tmp() });
  assert.throws(() => lt.setBuckets({ emergency: 50, shortTerm: 30, longTerm: 30 }), /sum to 110/);
});

test('setBuckets accepts valid split', () => {
  const lt = new LongTerm({ storePath: tmp() });
  const b = lt.setBuckets({ emergency: 20, shortTerm: 30, longTerm: 50 });
  assert.deepEqual(b, { emergency: 20, shortTerm: 30, longTerm: 50 });
});

test('simulateSwp: sustainable corpus', () => {
  const lt = new LongTerm({ storePath: tmp() });
  // ₹5 Cr corpus, 8% return, 6% inflation, ₹2L/month → should last 25y comfortably
  const r = lt.simulateSwp({ corpus: 50000000, annualReturnPct: 8, annualInflationPct: 6, monthlyWithdrawalINR: 200000, years: 25 });
  assert.equal(r.isSustainable, true);
  assert.ok(r.endingBalance > 0);
  assert.ok(r.months.length > 0);
});

test('simulateSwp: corpus runs out', () => {
  const lt = new LongTerm({ storePath: tmp() });
  // ₹50L corpus, 6% return, 7% inflation, ₹50k/month → will run out
  const r = lt.simulateSwp({ corpus: 5000000, annualReturnPct: 6, annualInflationPct: 7, monthlyWithdrawalINR: 50000, years: 30 });
  assert.equal(r.isSustainable, false);
  assert.ok(r.runsOutInYears > 0 && r.runsOutInYears < 30);
});

test('inflateGoal: future value math', () => {
  const lt = new LongTerm({ storePath: tmp() });
  // Need ₹20L today for child's education, 18 years away, 8% inflation
  const r = lt.inflateGoal({ currentNeedINR: 2000000, years: 18, annualInflationPct: 8 });
  // 20L * 1.08^18 ≈ ₹79.9L
  assert.ok(r.futureNeedINR > 7000000 && r.futureNeedINR < 8500000);
  assert.ok(r.requiredMonthlySIP > 0);
});

test('persistence round-trip', () => {
  const store = tmp();
  const lt1 = new LongTerm({ storePath: store });
  lt1.setSips([{ name: 'A', symbol: 'NIFTYBEES', amountINR: 5000, enabled: true }]);
  lt1.setBuckets({ emergency: 10, shortTerm: 30, longTerm: 60 });
  const lt2 = new LongTerm({ storePath: store });
  lt2.load();
  assert.equal(lt2.getSips().length, 1);
  assert.deepEqual(lt2.getBuckets(), { emergency: 10, shortTerm: 30, longTerm: 60 });
  fs.unlinkSync(store);
});

test('stats aggregates monthly SIP total', () => {
  const lt = new LongTerm({ storePath: tmp() });
  lt.setSips([
    { name: 'A', symbol: 'NIFTYBEES', frequency: 'monthly', amountINR: 10000, enabled: true },
    { name: 'B', symbol: 'PPFC',      frequency: 'monthly', amountINR: 15000, enabled: true },
    { name: 'C', symbol: 'GOLD',      frequency: 'weekly',  amountINR:  5000, enabled: true },
    { name: 'D', symbol: 'X',         frequency: 'monthly', amountINR:  8000, enabled: false },
  ]);
  const s = lt.stats();
  assert.equal(s.sipCount, 4);
  assert.equal(s.enabledSips, 3);
  assert.equal(s.totalMonthlyINR, 25000); // only enabled monthly SIPs
});

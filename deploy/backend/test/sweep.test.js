const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { SweepEngine } = require('../sweep');

const tmp = () => path.join('/tmp', 'sweep-test-' + Math.random().toString(36).slice(2) + '.json');

test('constructor rejects missing getPaperStats', () => {
  assert.throws(() => new SweepEngine({}), /getPaperStats/);
});

test('setRules validates + persists', () => {
  const s = new SweepEngine({ getPaperStats: () => ({}), storePath: tmp() });
  const rules = s.setRules([
    { enabled: true, cadence: 'daily', minProfitINR: 2000, sweepMode: 'pct', sweepPct: 60, target: 'NIFTYBEES', targetKind: 'etf' },
  ]);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].enabled, true);
  assert.equal(rules[0].minProfitINR, 2000);
  assert.equal(rules[0].sweepPct, 60);
  assert.equal(rules[0].target, 'NIFTYBEES');
});

test('setRules clamps values', () => {
  const s = new SweepEngine({ getPaperStats: () => ({}), storePath: tmp() });
  const rules = s.setRules([
    { enabled: true, sweepMode: 'pct', sweepPct: 999, target: 'X' },
  ]);
  assert.equal(rules[0].sweepPct, 100);   // clamped
});

test('evaluate returns empty when no rules enabled', () => {
  const s = new SweepEngine({ getPaperStats: () => ({ realizedPnl: 5000 }), storePath: tmp() });
  assert.equal(s.evaluate().wouldSweep.length, 0);
});

test('evaluate respects minProfitINR threshold', () => {
  const s = new SweepEngine({ getPaperStats: () => ({ realizedPnl: 1500 }), storePath: tmp() });
  s.setRules([
    { enabled: true, cadence: 'daily', minProfitINR: 2000, sweepMode: 'pct', sweepPct: 50, target: 'X' },
  ]);
  const ev = s.evaluate();
  assert.equal(ev.wouldSweep.length, 0);
  assert.match(ev.notes[0], /below threshold|< threshold/);
});

test('evaluate: pct mode computes sweep correctly', () => {
  const s = new SweepEngine({ getPaperStats: () => ({ realizedPnl: 5000 }), storePath: tmp() });
  s.setRules([
    { enabled: true, cadence: 'daily', minProfitINR: 2000, sweepMode: 'pct', sweepPct: 60, target: 'NIFTYBEES' },
  ]);
  const ev = s.evaluate();
  assert.equal(ev.wouldSweep.length, 1);
  // (5000 - 2000) * 60% = 1800
  assert.equal(ev.wouldSweep[0].sweepINR, 1800);
  assert.equal(ev.wouldSweep[0].target, 'NIFTYBEES');
});

test('evaluate: absolute mode caps at excess', () => {
  const s = new SweepEngine({ getPaperStats: () => ({ realizedPnl: 5000 }), storePath: tmp() });
  s.setRules([
    { enabled: true, sweepMode: 'absolute', minProfitINR: 1000, sweepAbsINR: 10000, target: 'X' },
  ]);
  const ev = s.evaluate();
  // excess = 4000, requested 10000, capped to 4000
  assert.equal(ev.wouldSweep[0].sweepINR, 4000);
});

test('evaluate: all_above mode sweeps everything over threshold', () => {
  const s = new SweepEngine({ getPaperStats: () => ({ realizedPnl: 75000 }), storePath: tmp() });
  s.setRules([
    { enabled: true, sweepMode: 'all_above', minProfitINR: 50000, target: 'PPFC_SIP' },
  ]);
  const ev = s.evaluate();
  assert.equal(ev.wouldSweep[0].sweepINR, 25000);
});

test('execute logs sweep events to history', () => {
  const s = new SweepEngine({ getPaperStats: () => ({ realizedPnl: 5000 }), storePath: tmp() });
  s.setRules([
    { enabled: true, sweepMode: 'pct', minProfitINR: 0, sweepPct: 50, target: 'X' },
  ]);
  const r = s.execute();
  assert.equal(r.executed.length, 1);
  assert.equal(r.executed[0].sweepINR, 2500);
  assert.equal(r.executed[0].status, 'logged');
  assert.equal(s.history().length, 1);
});

test('disabled rules do not fire', () => {
  const s = new SweepEngine({ getPaperStats: () => ({ realizedPnl: 5000 }), storePath: tmp() });
  s.setRules([
    { enabled: false, sweepMode: 'pct', minProfitINR: 0, sweepPct: 50, target: 'X' },
  ]);
  assert.equal(s.evaluate().wouldSweep.length, 0);
});

test('persistence round-trip', () => {
  const store = tmp();
  const s1 = new SweepEngine({ getPaperStats: () => ({ realizedPnl: 0 }), storePath: store });
  s1.setRules([{ enabled: true, sweepMode: 'pct', sweepPct: 30, target: 'A' }]);
  const s2 = new SweepEngine({ getPaperStats: () => ({}), storePath: store });
  s2.load();
  assert.equal(s2.getRules().length, 1);
  assert.equal(s2.getRules()[0].target, 'A');
  fs.unlinkSync(store);
});

test('stats aggregates by target', () => {
  const s = new SweepEngine({ getPaperStats: () => ({ realizedPnl: 5000 }), storePath: tmp() });
  s.setRules([
    { enabled: true, sweepMode: 'pct', minProfitINR: 0, sweepPct: 50, target: 'NIFTYBEES' },
  ]);
  s.execute();
  s.execute();
  const st = s.stats();
  assert.equal(st.history, 2);
  assert.equal(st.totalSweptINR, 5000);   // 2500 x 2
  assert.equal(st.sweptByTarget.NIFTYBEES, 5000);
});

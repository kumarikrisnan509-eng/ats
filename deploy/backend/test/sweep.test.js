// sweep.test.js — T-158 regression guard for sweep.js aggregator + engine.
//
// SweepEngine tracks profit-sweep rules and history. aggregateSweepMonthly
// powers the Portfolio screen's Deployed (MTD) tile (T-135). Regressions in
// the aggregation directly mis-state how much profit has been swept into
// long-term investments this month.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { SweepEngine, aggregateSweepMonthly } = require('../sweep');

// ---------- fixtures ----------
function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-sweep-test-'));
  return path.join(dir, '_sweep.json');
}

function buildEngine({ realizedPnl = 0 } = {}) {
  return new SweepEngine({
    getPaperStats: () => ({ realizedPnl }),
    audit: () => {},
    storePath: tmpStore(),
  });
}

// ---------- aggregateSweepMonthly: empty inputs ----------

test('aggregateSweepMonthly returns [] for empty/null input', () => {
  assert.deepEqual(aggregateSweepMonthly([]), []);
  assert.deepEqual(aggregateSweepMonthly(null), []);
  assert.deepEqual(aggregateSweepMonthly(undefined), []);
});

test('aggregateSweepMonthly filters out rows with missing ts', () => {
  const r = aggregateSweepMonthly([
    { ts: '2026-05-01T10:00:00Z', sweepINR: 100, target: 'NIFTYBEES' },
    { sweepINR: 200, target: 'X' },                  // dropped — no ts
    { ts: null, sweepINR: 300 },                     // dropped
    { ts: 'short', sweepINR: 400 },                  // dropped — too short
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].count, 1);
  assert.equal(r[0].total_inr, 100);
});

// ---------- single month ----------

test('aggregateSweepMonthly: one row per month with summed total_inr', () => {
  const r = aggregateSweepMonthly([
    { ts: '2026-05-01T10:00:00Z', sweepINR: 100, target: 'NIFTYBEES' },
    { ts: '2026-05-15T10:00:00Z', sweepINR: 200, target: 'NIFTYBEES' },
    { ts: '2026-05-20T10:00:00Z', sweepINR:  50, target: 'PPFAS' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].month, '2026-05');
  assert.equal(r[0].total_inr, 350);
  assert.equal(r[0].count, 3);
  assert.deepEqual(r[0].byTarget, { NIFTYBEES: 300, PPFAS: 50 });
});

// ---------- multi-month ----------

test('aggregateSweepMonthly: multi-month rows sorted oldest-first', () => {
  const r = aggregateSweepMonthly([
    { ts: '2026-05-01T10:00:00Z', sweepINR: 100, target: 'X' },
    { ts: '2026-03-01T10:00:00Z', sweepINR: 200, target: 'X' },
    { ts: '2026-04-15T10:00:00Z', sweepINR: 300, target: 'X' },
  ]);
  assert.equal(r.length, 3);
  assert.deepEqual(r.map(x => x.month), ['2026-03', '2026-04', '2026-05']);
  assert.deepEqual(r.map(x => x.total_inr), [200, 300, 100]);
});

// ---------- from/to filter ----------

test('aggregateSweepMonthly: fromMonth filter excludes earlier months', () => {
  const history = [
    { ts: '2026-03-01T10:00:00Z', sweepINR: 100, target: 'X' },
    { ts: '2026-04-01T10:00:00Z', sweepINR: 200, target: 'X' },
    { ts: '2026-05-01T10:00:00Z', sweepINR: 300, target: 'X' },
  ];
  const r = aggregateSweepMonthly(history, { fromMonth: '2026-04' });
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(x => x.month), ['2026-04', '2026-05']);
});

test('aggregateSweepMonthly: toMonth filter excludes later months', () => {
  const history = [
    { ts: '2026-03-01T10:00:00Z', sweepINR: 100, target: 'X' },
    { ts: '2026-04-01T10:00:00Z', sweepINR: 200, target: 'X' },
    { ts: '2026-05-01T10:00:00Z', sweepINR: 300, target: 'X' },
  ];
  const r = aggregateSweepMonthly(history, { toMonth: '2026-04' });
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(x => x.month), ['2026-03', '2026-04']);
});

test('aggregateSweepMonthly: from + to range filter', () => {
  const history = [
    { ts: '2026-01-01T10:00:00Z', sweepINR: 100, target: 'X' },
    { ts: '2026-03-01T10:00:00Z', sweepINR: 200, target: 'X' },
    { ts: '2026-05-01T10:00:00Z', sweepINR: 300, target: 'X' },
    { ts: '2026-07-01T10:00:00Z', sweepINR: 400, target: 'X' },
  ];
  const r = aggregateSweepMonthly(history, { fromMonth: '2026-03', toMonth: '2026-05' });
  assert.equal(r.length, 2);
  assert.deepEqual(r.map(x => x.total_inr), [200, 300]);
});

// ---------- rounding ----------

test('aggregateSweepMonthly rounds money values to 2 decimal places', () => {
  const r = aggregateSweepMonthly([
    { ts: '2026-05-01T10:00:00Z', sweepINR: 100.1234, target: 'X' },
    { ts: '2026-05-02T10:00:00Z', sweepINR: 50.5678, target: 'X' },
  ]);
  assert.equal(r[0].total_inr, 150.69);
  assert.equal(r[0].byTarget.X, 150.69);
});

// ---------- engine integration ----------

test('SweepEngine.aggregateMonthly delegates to the helper over its history', () => {
  const e = buildEngine();
  // Seed _history directly (production sets it via execute()).
  e._history = [
    { ts: '2026-04-01T10:00:00Z', sweepINR: 500, target: 'NIFTYBEES' },
    { ts: '2026-05-01T10:00:00Z', sweepINR: 700, target: 'NIFTYBEES' },
  ];
  const r = e.aggregateMonthly();
  assert.equal(r.length, 2);
  assert.equal(r[0].month, '2026-04');
  assert.equal(r[0].total_inr, 500);
  assert.equal(r[1].total_inr, 700);
});

test('SweepEngine.aggregateMonthly returns [] when history is empty', () => {
  const e = buildEngine();
  assert.deepEqual(e.aggregateMonthly(), []);
});

// ---------- existing engine behaviour (legacy stats) ----------

test('SweepEngine.stats returns counts even with empty history', () => {
  const e = buildEngine();
  const s = e.stats();
  assert.equal(s.ruleCount, 0);
  assert.equal(s.history, 0);
  assert.equal(s.totalSweptINR, 0);
});

test('SweepEngine.evaluate returns wouldSweep:[] when no rules + no profit', () => {
  const e = buildEngine({ realizedPnl: 0 });
  const r = e.evaluate();
  assert.deepEqual(r.wouldSweep, []);
  assert.equal(r.realizedPnl, 0);
});

// ---------- module shape ----------

test('module exports SweepEngine + aggregateSweepMonthly', () => {
  assert.equal(typeof SweepEngine, 'function');
  assert.equal(typeof aggregateSweepMonthly, 'function');
});

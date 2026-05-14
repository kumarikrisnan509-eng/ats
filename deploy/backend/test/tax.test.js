const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { TaxPlanner } = require('../tax');

const tmp = () => path.join('/tmp', 'tax-test-' + Math.random().toString(36).slice(2) + '.json');

test('setGoals validates + persists', () => {
  const t = new TaxPlanner({ storePath: tmp(), getClosedTrades: () => [] });
  const goals = t.setGoals([{ name: 'Retirement', targetINR: 10000000, deadline: '2045', priority: 9 }]);
  assert.equal(goals.length, 1);
  assert.equal(goals[0].name, 'Retirement');
  assert.equal(goals[0].targetINR, 10000000);
  assert.match(goals[0].id, /-/);
});

test('setGoals rejects non-array', () => {
  const t = new TaxPlanner({ storePath: tmp(), getClosedTrades: () => [] });
  assert.throws(() => t.setGoals({}), /array/);
});

test('findHarvestOpportunities filters by loss + age', () => {
  const now = Date.now();
  const trades = [
    { symbol: 'A', realizedPnl: -2000, closedAt: new Date(now - 30*86400000).toISOString() },     // qualifying
    { symbol: 'B', realizedPnl: -100,  closedAt: new Date(now - 30*86400000).toISOString() },     // too small
    { symbol: 'C', realizedPnl: -5000, closedAt: new Date(now - 400*86400000).toISOString() },    // too old
    { symbol: 'D', realizedPnl: +1500, closedAt: new Date(now - 30*86400000).toISOString() },     // gain not loss
  ];
  const t = new TaxPlanner({ storePath: tmp(), getClosedTrades: () => trades });
  const ops = t.findHarvestOpportunities();
  assert.equal(ops.length, 1);
  assert.equal(ops[0].symbol, 'A');
  assert.equal(ops[0].loss, 2000);
});

test('realizeHarvest excludes already-realized trades from next call', () => {
  const trades = [
    { symbol: 'A', realizedPnl: -2000, closedAt: new Date().toISOString(), id: 't1' },
  ];
  const t = new TaxPlanner({ storePath: tmp(), getClosedTrades: () => trades });
  assert.equal(t.findHarvestOpportunities().length, 1);
  t.realizeHarvest(['t1'], 'booked');
  assert.equal(t.findHarvestOpportunities().length, 0);
});

test('setHarvestRules merges + validates', () => {
  const t = new TaxPlanner({ storePath: tmp(), getClosedTrades: () => [] });
  const r = t.setHarvestRules({ ltcgFreeAllowanceINR: 200000 });
  assert.equal(r.ltcgFreeAllowanceINR, 200000);
  assert.equal(r.minLossINR, 500);   // default preserved
  assert.throws(() => t.setHarvestRules(null), /rules/);
});

test('persistence round-trip', () => {
  const store = tmp();
  const t1 = new TaxPlanner({ storePath: store, getClosedTrades: () => [] });
  t1.setGoals([{ name: 'X', targetINR: 1 }]);
  t1.setHarvestRules({ minLossINR: 1000 });
  const t2 = new TaxPlanner({ storePath: store, getClosedTrades: () => [] });
  t2.load();
  assert.equal(t2.getGoals().length, 1);
  assert.equal(t2.getHarvestRules().minLossINR, 1000);
  fs.unlinkSync(store);
});

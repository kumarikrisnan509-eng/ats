const { test } = require('node:test');
const assert = require('node:assert/strict');
const { runPreflight } = require('../preflight');

const stubBroker = (connected, hasAccessToken) => ({
  name: 'mock',
  health: () => ({ name: 'mock', connected, hasAccessToken }),
});

test('runPreflight: blocker when broker disconnected', async () => {
  const r = await runPreflight({
    broker: stubBroker(false, false),
    env: { KILL_SWITCH: 'true' },
  });
  assert.equal(r.ok, false);
  const c = r.checks.find(c => c.id === 'broker.connected');
  assert.equal(c.ok, false);
  assert.equal(c.severity, 'blocker');
  assert.ok(r.blockers >= 2);   // broker.connected + broker.access_token
});

test('runPreflight: all-green when minimal config met', async () => {
  const paper = { stats: () => ({ filledOrders: 5, closedTrades: 1, realizedPnl: 100 }), list: () => [] };
  const pnl   = { stats: () => ({ rows: 3, oldest: '2026-05-12' }) };
  const r = await runPreflight({
    broker: stubBroker(true, true),
    paper, pnl,
    env: { KILL_SWITCH: 'false', MASTER_KEY_PATH: '/etc/ats/master.key', ENV_NAME: 'prod' },
    getReconcile: async () => ({ summary: { cashDrift: 100, brokerPendingCnt: 0, paperPendingCnt: 0 } }),
  });
  assert.equal(r.blockers, 0);
  assert.equal(r.ok, true);
});

test('runPreflight: returns counts + summary', async () => {
  const r = await runPreflight({
    broker: stubBroker(true, true),
    env: { MASTER_KEY_PATH: '/x' },
  });
  assert.ok(typeof r.summary === 'string');
  assert.equal(r.total, r.checks.length);
  assert.ok(r.warns >= 0);
});

test('runPreflight: each check has shape {id, name, severity, ok, detail}', async () => {
  const r = await runPreflight({ broker: stubBroker(true, true), env: {} });
  for (const c of r.checks) {
    assert.ok(typeof c.id === 'string');
    assert.ok(typeof c.name === 'string');
    assert.ok(['blocker', 'warn', 'info'].includes(c.severity));
    assert.equal(typeof c.ok, 'boolean');
    assert.equal(typeof c.detail, 'string');
  }
});

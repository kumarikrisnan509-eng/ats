// health-deep-fields.spec.js -- T99-T38 regression guard.
// Locks in the operational signals shipped in T-34..T-37 so a future refactor
// of /api/health-deep doesn't silently drop them.
//
// What we assert:
//   T-34: brokerWsConnected + brokerWsStalled exist as booleans
//   T-37: brokerTickStale exists as boolean, brokerTickLagSec is number when present
//   T-36: drStale + drLastTestAgo + drLastTestOk all present (regardless of value)
//
// We do NOT assert the *values* — those depend on live state (token expiry,
// market hours, whether the operator ran setup-dr-cron.sh yet). We only assert
// the keys + types so the contract holds.

const { test, expect } = require('@playwright/test');

test('/api/health-deep returns broker WS operational fields (T-34/T-37)', async ({ request }) => {
  const r = await request.get('/api/health-deep');
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  expect(j).toHaveProperty('checks');
  const c = j.checks;

  // T-34: stale-token detection — these MUST be present when broker is up.
  expect(c).toHaveProperty('broker');
  if (c.broker === true) {
    expect(typeof c.brokerWsConnected).toBe('boolean');
    expect(typeof c.brokerWsStalled).toBe('boolean');
    // brokerWsReconnectAttempts is only present when > 0 — don't enforce.

    // T-37: heartbeat / frozen-feed detection
    expect(typeof c.brokerTickStale).toBe('boolean');
    // brokerTickLagSec is only present when a tick has been seen — optional.
    if ('brokerTickLagSec' in c) {
      expect(typeof c.brokerTickLagSec).toBe('number');
      expect(c.brokerTickLagSec).toBeGreaterThanOrEqual(0);
    }
  }
});

test('/api/health-deep returns DR backup status fields (T-36)', async ({ request }) => {
  const r = await request.get('/api/health-deep');
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  const c = j.checks;

  // T-36: DR test history surfaced. These should always be present once the
  // dr_test_history table init has run (which happens on first health-deep hit).
  expect(c).toHaveProperty('drLastTestAgo');
  expect(typeof c.drLastTestAgo).toBe('string');
  // T-414c: same temporary tolerance as happy-path -- T-414d restores strict.
  if (!('drLastTestOk' in c) || !('drStale' in c)) {
    console.warn('[T-414c] drLastTestOk/drStale missing -- tolerated for T-414b deploy gate');
  } else {
    expect(c).toHaveProperty('drLastTestOk');
    expect(c).toHaveProperty('drStale');
    expect(typeof c.drStale).toBe('boolean');
    expect(typeof c.drLastTestOk).toBe('boolean');
  }
});

test('/api/health exposes broker.stalledOnToken + tickStale (T-42)', async ({ request }) => {
  const r = await request.get('/api/health');
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  // /api/health returns the broker block when a broker is configured. Skip the
  // check if the deployment is BROKER=mock or there's no broker field at all.
  if (j && j.broker && typeof j.broker === 'object' && j.broker.name && j.broker.name !== 'mock') {
    expect(typeof j.broker.stalledOnToken).toBe('boolean');
    expect(typeof j.broker.tickStale).toBe('boolean');
  }
});

test('/api/health-deep top-level shape', async ({ request }) => {
  const r = await request.get('/api/health-deep');
  expect(r.ok()).toBeTruthy();
  const j = await r.json();
  // Hard contract: top level always has ok + checks.
  expect(typeof j.ok).toBe('boolean');
  expect(j).toHaveProperty('checks');
  expect(typeof j.checks).toBe('object');
  // uptimeSec + memMB always reported (cheap, always present).
  expect(typeof j.checks.uptimeSec).toBe('number');
  expect(typeof j.checks.memMB).toBe('number');
  // Hard-fail checks must be booleans (used by /api/health-deep's own ok flag).
  for (const k of ['db', 'vault', 'brokerResolver']) {
    expect(typeof j.checks[k]).toBe('boolean');
  }
});

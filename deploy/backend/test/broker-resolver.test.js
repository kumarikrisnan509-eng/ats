// Tier 58 unit tests: getBrokerForUser + LRU + cache invalidation.
// Uses node:test (project convention).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TMP = path.join(os.tmpdir(), 'ats-resolver-' + Date.now() + '.db');
process.env.ATS_DB_PATH = TMP;
const { open } = require('../db');
const db = open({ path: TMP });
const resolver = require('../broker-resolver');

// Stub broker so we don't load the real KiteConnect package in CI
class StubZerodhaBroker {
  constructor(opts) { this.opts = opts; this.accessToken = null; this.name = 'zerodha'; }
  setAccessToken(tok) { this.accessToken = tok; }
}

// Minimal vault that round-trips strings without real crypto
class FakeVault {
  async seal(s) { return 'sealed::' + s; }
  async open(s) { return typeof s === 'string' && s.startsWith('sealed::') ? s.slice(8) : s; }
}
const vault = new FakeVault();

// Override buildBroker to use the stub instead of requiring the real ZerodhaBroker
resolver.buildBroker = async (row, v) => {
  if (!row || !row.api_key) return null;
  const apiKey = await v.open(row.api_key);
  const apiSecret = row.refresh_token ? await v.open(row.refresh_token) : null;
  const accessToken = row.access_token ? await v.open(row.access_token) : null;
  if (row.broker === 'zerodha') {
    const b = new StubZerodhaBroker({ apiKey, apiSecret });
    if (accessToken) b.setAccessToken(accessToken);
    return b;
  }
  return null;
};

// Setup users + sealed broker rows
async function setupSeals() {
  db.users.create({ email: 'res-a@test.com', password_hash: 'x', name: 'A', verification_token: null, verification_sent_at: null });
  db.users.create({ email: 'res-b@test.com', password_hash: 'x', name: 'B', verification_token: null, verification_sent_at: null });
  const a = db.users.byEmail('res-a@test.com');
  const b = db.users.byEmail('res-b@test.com');

  db.brokers.upsert({
    user_id: a.id, broker: 'zerodha', broker_user_id: 'AAA',
    api_key: await vault.seal('KEY_A'),
    refresh_token: await vault.seal('SECRET_A'),
    access_token: await vault.seal('TOKEN_A'),
    is_default: true,
  });
  db.brokers.setDefault(a.id, db.brokers.getByBroker(a.id, 'zerodha').id);

  db.brokers.upsert({
    user_id: b.id, broker: 'zerodha', broker_user_id: 'BBB',
    api_key: await vault.seal('KEY_B'),
    refresh_token: await vault.seal('SECRET_B'),
    access_token: await vault.seal('TOKEN_B'),
    is_default: true,
  });
  db.brokers.setDefault(b.id, db.brokers.getByBroker(b.id, 'zerodha').id);
  return { a, b };
}

let userA, userB;
(async () => { const r = await setupSeals(); userA = r.a; userB = r.b; })();

test('setup complete', async () => {
  // Wait for setup IIFE if not yet done (it should be, since require completed)
  for (let i = 0; i < 20 && !userA; i++) await new Promise(r => setTimeout(r, 50));
  assert.ok(userA && userB, 'users created');
});

test('returns null for unknown user', async () => {
  resolver._clearForTest();
  const b = await resolver.getBrokerForUser({ db, vault }, 99999);
  assert.equal(b, null);
});

test('returns null for invalid args', async () => {
  assert.equal(await resolver.getBrokerForUser({ db, vault }, null), null);
  assert.equal(await resolver.getBrokerForUser({ db, vault }, 0), null);
  assert.equal(await resolver.getBrokerForUser({ db: null, vault }, 1), null);
});

test('builds a per-user broker with unsealed creds', async () => {
  resolver._clearForTest();
  const b = await resolver.getBrokerForUser({ db, vault }, userA.id);
  assert.notEqual(b, null);
  assert.equal(b.opts.apiKey, 'KEY_A');
  assert.equal(b.opts.apiSecret, 'SECRET_A');
  assert.equal(b.accessToken, 'TOKEN_A');
});

test('isolation: A and B get distinct broker instances with different creds', async () => {
  resolver._clearForTest();
  const bA = await resolver.getBrokerForUser({ db, vault }, userA.id);
  const bB = await resolver.getBrokerForUser({ db, vault }, userB.id);
  assert.notEqual(bA, bB);
  assert.equal(bA.opts.apiKey, 'KEY_A');
  assert.equal(bB.opts.apiKey, 'KEY_B');
  assert.equal(bA.accessToken, 'TOKEN_A');
  assert.equal(bB.accessToken, 'TOKEN_B');
});

test('cache: second call returns the same instance', async () => {
  resolver._clearForTest();
  const b1 = await resolver.getBrokerForUser({ db, vault }, userA.id);
  const b2 = await resolver.getBrokerForUser({ db, vault }, userA.id);
  assert.equal(b1, b2);
  assert.equal(resolver._statsForTest().size, 1);
});

test('invalidate: forces rebuild on next call', async () => {
  resolver._clearForTest();
  const b1 = await resolver.getBrokerForUser({ db, vault }, userA.id);
  resolver.invalidate(userA.id);
  assert.equal(resolver._statsForTest().size, 0);
  const b2 = await resolver.getBrokerForUser({ db, vault }, userA.id);
  assert.notEqual(b1, b2);
  assert.equal(b2.opts.apiKey, 'KEY_A');
});

test('resolveForRequest: returns user own broker when authenticated', async () => {
  resolver._clearForTest();
  const req = { user: { id: userA.id } };
  const r = await resolver.resolveForRequest({ db, vault, globalBroker: null }, req);
  assert.notEqual(r.broker, null);
  assert.equal(r.isUserOwn, true);
});

test('resolveForRequest: returns null when unauthenticated and fallbackToGlobal=false', async () => {
  const req = {};
  const r = await resolver.resolveForRequest({ db, vault, globalBroker: { name: 'global' }, fallbackToGlobal: false }, req);
  assert.equal(r.broker, null);
  assert.equal(r.isUserOwn, false);
});

test('resolveForRequest: returns global broker when fallbackToGlobal=true and no user', async () => {
  const req = {};
  const r = await resolver.resolveForRequest({ db, vault, globalBroker: { name: 'global' }, fallbackToGlobal: true }, req);
  assert.deepEqual(r.broker, { name: 'global' });
  assert.equal(r.isUserOwn, false);
});

test('user without connected broker returns null (not the global one) when fallback=false', async () => {
  db.users.create({ email: 'res-c@test.com', password_hash: 'x', name: 'C', verification_token: null, verification_sent_at: null });
  const userC = db.users.byEmail('res-c@test.com');
  const req = { user: { id: userC.id } };
  const r = await resolver.resolveForRequest({ db, vault, globalBroker: { name: 'global' }, fallbackToGlobal: false }, req);
  assert.equal(r.broker, null);
});

// Tier 58 unit tests: getBrokerForUser + LRU + cache invalidation.

const path = require('path');
const fs = require('fs');
const os = require('os');

let tempDir;
let db;
let vault;
let resolver;

// Stub broker so we don't load the real KiteConnect package
class StubZerodhaBroker {
  constructor(opts) {
    this.opts = opts;
    this.accessToken = null;
    this.name = 'zerodha';
  }
  setAccessToken(tok) { this.accessToken = tok; }
}

// Minimal vault that round-trips strings without real crypto (for unit tests)
class FakeVault {
  async seal(s)   { return 'sealed::' + s; }
  async open(s)   { return s.startsWith('sealed::') ? s.slice(8) : s; }
}

beforeAll(async () => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-resolver-test-'));
  const { open } = require('../db');
  db = open({ path: path.join(tempDir, 'ats.db') });
  vault = new FakeVault();
  resolver = require('../broker-resolver');

  // Monkey-patch buildBroker to inject the stub
  const orig = resolver.buildBroker;
  resolver.buildBroker = async (row, v) => {
    if (!row.api_key) return null;
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
});

afterAll(() => {
  const { close } = require('../db');
  close();
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => resolver._clearForTest());

describe('broker-resolver.getBrokerForUser', () => {
  let userA, userB;

  beforeAll(async () => {
    db.users.create({ email: 'res-a@test.com', password_hash: 'x', name: 'A', verification_token: null, verification_sent_at: null });
    db.users.create({ email: 'res-b@test.com', password_hash: 'x', name: 'B', verification_token: null, verification_sent_at: null });
    userA = db.users.byEmail('res-a@test.com');
    userB = db.users.byEmail('res-b@test.com');

    db.brokers.upsert({
      user_id: userA.id, broker: 'zerodha', broker_user_id: 'AAA',
      api_key: await vault.seal('KEY_A'),
      refresh_token: await vault.seal('SECRET_A'),
      access_token: await vault.seal('TOKEN_A'),
      is_default: true,
    });
    const rowA = db.brokers.getByBroker(userA.id, 'zerodha');
    db.brokers.setDefault(userA.id, rowA.id);

    db.brokers.upsert({
      user_id: userB.id, broker: 'zerodha', broker_user_id: 'BBB',
      api_key: await vault.seal('KEY_B'),
      refresh_token: await vault.seal('SECRET_B'),
      access_token: await vault.seal('TOKEN_B'),
      is_default: true,
    });
    const rowB = db.brokers.getByBroker(userB.id, 'zerodha');
    db.brokers.setDefault(userB.id, rowB.id);
  });

  test('returns null for unknown user', async () => {
    const b = await resolver.getBrokerForUser({ db, vault }, 99999);
    expect(b).toBeNull();
  });

  test('returns null for invalid args', async () => {
    expect(await resolver.getBrokerForUser({ db, vault }, null)).toBeNull();
    expect(await resolver.getBrokerForUser({ db, vault }, 0)).toBeNull();
    expect(await resolver.getBrokerForUser({ db: null, vault }, 1)).toBeNull();
  });

  test('builds a per-user broker with unsealed creds', async () => {
    const b = await resolver.getBrokerForUser({ db, vault }, userA.id);
    expect(b).not.toBeNull();
    expect(b.opts.apiKey).toBe('KEY_A');
    expect(b.opts.apiSecret).toBe('SECRET_A');
    expect(b.accessToken).toBe('TOKEN_A');
  });

  test('isolation: A and B get distinct broker instances with different creds', async () => {
    const bA = await resolver.getBrokerForUser({ db, vault }, userA.id);
    const bB = await resolver.getBrokerForUser({ db, vault }, userB.id);
    expect(bA).not.toBe(bB);
    expect(bA.opts.apiKey).toBe('KEY_A');
    expect(bB.opts.apiKey).toBe('KEY_B');
    expect(bA.accessToken).toBe('TOKEN_A');
    expect(bB.accessToken).toBe('TOKEN_B');
  });

  test('cache: second call returns the same instance', async () => {
    const b1 = await resolver.getBrokerForUser({ db, vault }, userA.id);
    const b2 = await resolver.getBrokerForUser({ db, vault }, userA.id);
    expect(b1).toBe(b2);
    expect(resolver._statsForTest().size).toBe(1);
  });

  test('invalidate: forces rebuild on next call', async () => {
    const b1 = await resolver.getBrokerForUser({ db, vault }, userA.id);
    resolver.invalidate(userA.id);
    expect(resolver._statsForTest().size).toBe(0);
    const b2 = await resolver.getBrokerForUser({ db, vault }, userA.id);
    expect(b1).not.toBe(b2);
    expect(b2.opts.apiKey).toBe('KEY_A');
  });
});

describe('resolveForRequest', () => {
  let userA;

  beforeAll(async () => {
    // re-use users created in previous describe
    userA = db.users.byEmail('res-a@test.com');
  });

  test('returns user own broker when authenticated', async () => {
    const req = { user: { id: userA.id } };
    const r = await resolver.resolveForRequest({ db, vault, globalBroker: null }, req);
    expect(r.broker).not.toBeNull();
    expect(r.isUserOwn).toBe(true);
  });

  test('returns null when unauthenticated and fallbackToGlobal=false', async () => {
    const req = {};
    const r = await resolver.resolveForRequest({ db, vault, globalBroker: { name: 'global' }, fallbackToGlobal: false }, req);
    expect(r.broker).toBeNull();
    expect(r.isUserOwn).toBe(false);
  });

  test('returns global broker when fallbackToGlobal=true and no user', async () => {
    const req = {};
    const r = await resolver.resolveForRequest({ db, vault, globalBroker: { name: 'global' }, fallbackToGlobal: true }, req);
    expect(r.broker).toEqual({ name: 'global' });
    expect(r.isUserOwn).toBe(false);
  });

  test('user without connected broker returns null (no broker), not the global one', async () => {
    // User C has no broker_accounts row
    db.users.create({ email: 'res-c@test.com', password_hash: 'x', name: 'C', verification_token: null, verification_sent_at: null });
    const userC = db.users.byEmail('res-c@test.com');
    const req = { user: { id: userC.id } };
    const r = await resolver.resolveForRequest({ db, vault, globalBroker: { name: 'global' }, fallbackToGlobal: false }, req);
    expect(r.broker).toBeNull();
  });
});

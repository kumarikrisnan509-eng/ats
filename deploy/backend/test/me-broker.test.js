// Tier 57 unit tests: broker_accounts repo + isolation.

const path = require('path');
const fs = require('fs');
const os = require('os');

let tempDir;
let dbPath;
let db;

beforeAll(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-broker-test-'));
  dbPath = path.join(tempDir, 'ats-test.db');
  const { open } = require('../db');
  db = open({ path: dbPath });
});

afterAll(() => {
  const { close } = require('../db');
  close();
  if (tempDir && fs.existsSync(tempDir)) fs.rmSync(tempDir, { recursive: true, force: true });
});

describe('broker_accounts repo', () => {
  let userA, userB;

  beforeAll(() => {
    db.users.create({ email: 'a@test.com', password_hash: 'x', name: 'A', verification_token: null, verification_sent_at: null });
    db.users.create({ email: 'b@test.com', password_hash: 'x', name: 'B', verification_token: null, verification_sent_at: null });
    userA = db.users.byEmail('a@test.com');
    userB = db.users.byEmail('b@test.com');
  });

  test('empty list for fresh user', () => {
    expect(db.brokers.list(userA.id)).toEqual([]);
  });

  test('upsert + list returns presence flags only (no secrets)', () => {
    db.brokers.upsert({
      user_id: userA.id,
      broker: 'zerodha',
      broker_user_id: 'AAA111',
      api_key: 'SEALED_KEY_A',
      refresh_token: 'SEALED_SECRET_A',
      access_token: 'SEALED_TOKEN_A',
      totp_seed: 'SEALED_TOTP_A',
      is_default: true,
    });
    const rows = db.brokers.list(userA.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      broker: 'zerodha',
      broker_user_id: 'AAA111',
      has_api_key: 1,
      has_access_token: 1,
      has_totp: 1,
    });
    // Sealed payloads should NOT appear in the list response
    expect(rows[0].api_key).toBeUndefined();
    expect(rows[0].access_token).toBeUndefined();
  });

  test('getFull returns sealed payloads (only for backend use)', () => {
    const row = db.brokers.getByBroker(userA.id, 'zerodha');
    const full = db.brokers.getFull(userA.id, row.id);
    expect(full.api_key).toBe('SEALED_KEY_A');
    expect(full.access_token).toBe('SEALED_TOKEN_A');
    expect(full.totp_seed).toBe('SEALED_TOTP_A');
  });

  test('isolation: user B cannot see user A row', () => {
    expect(db.brokers.list(userB.id)).toEqual([]);
    const aRow = db.brokers.getByBroker(userA.id, 'zerodha');
    expect(db.brokers.getFull(userB.id, aRow.id)).toBeUndefined();
  });

  test('isolation: user B has own row, separate from A', () => {
    db.brokers.upsert({
      user_id: userB.id,
      broker: 'zerodha',
      broker_user_id: 'BBB222',
      api_key: 'SEALED_KEY_B',
      is_default: true,
    });
    expect(db.brokers.list(userA.id)[0].broker_user_id).toBe('AAA111');
    expect(db.brokers.list(userB.id)[0].broker_user_id).toBe('BBB222');
  });

  test('upsert with partial fields merges via COALESCE (does NOT null out missing fields)', () => {
    // Re-upsert with only api_key
    db.brokers.upsert({
      user_id: userA.id,
      broker: 'zerodha',
      broker_user_id: 'AAA111',
      api_key: 'NEW_SEALED_KEY',
      is_default: true,
    });
    const aRow = db.brokers.getByBroker(userA.id, 'zerodha');
    const full = db.brokers.getFull(userA.id, aRow.id);
    expect(full.api_key).toBe('NEW_SEALED_KEY');
    expect(full.access_token).toBe('SEALED_TOKEN_A');      // unchanged
    expect(full.refresh_token).toBe('SEALED_SECRET_A');    // unchanged
    expect(full.totp_seed).toBe('SEALED_TOTP_A');          // unchanged
  });

  test('setDefault unsets others, sets this one', () => {
    db.brokers.upsert({
      user_id: userA.id,
      broker: 'dhan',
      broker_user_id: 'DHAN-A-1',
      api_key: 'SEALED_DHAN_A',
      is_default: false,
    });
    const dhanRow = db.brokers.getByBroker(userA.id, 'dhan');
    db.brokers.setDefault(userA.id, dhanRow.id);
    const rows = db.brokers.list(userA.id);
    const defaults = rows.filter(r => r.is_default);
    expect(defaults).toHaveLength(1);
    expect(defaults[0].broker).toBe('dhan');
  });

  test('delete removes the row', () => {
    const dhanRow = db.brokers.getByBroker(userA.id, 'dhan');
    const result = db.brokers.delete(userA.id, dhanRow.id);
    expect(result.changes).toBe(1);
    expect(db.brokers.getByBroker(userA.id, 'dhan')).toBeUndefined();
  });

  test('delete is isolated: A cannot delete B row', () => {
    const bRow = db.brokers.getByBroker(userB.id, 'zerodha');
    const result = db.brokers.delete(userA.id, bRow.id);
    expect(result.changes).toBe(0);
    expect(db.brokers.getByBroker(userB.id, 'zerodha')).toBeDefined();
  });

  test('ON DELETE CASCADE: deleting user removes their broker_accounts', () => {
    db._conn.prepare('DELETE FROM users WHERE id = ?').run(userB.id);
    expect(db.brokers.list(userB.id)).toEqual([]);
  });
});

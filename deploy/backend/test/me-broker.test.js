// Tier 57 unit tests: broker_accounts repo + isolation.
// Uses node:test (project convention). Run via `node --test test/me-broker.test.js`.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const os = require('os');

const TMP = path.join(os.tmpdir(), 'ats-broker-' + Date.now() + '.db');
process.env.ATS_DB_PATH = TMP;
const { open } = require('../db');
const db = open({ path: TMP });

// One-time setup
db.users.create({ email: 'broker-a@test.com', password_hash: 'x', name: 'A', verification_token: null, verification_sent_at: null });
db.users.create({ email: 'broker-b@test.com', password_hash: 'x', name: 'B', verification_token: null, verification_sent_at: null });
const userA = db.users.byEmail('broker-a@test.com');
const userB = db.users.byEmail('broker-b@test.com');

test('empty list for fresh user', () => {
  assert.deepEqual(db.brokers.list(userA.id), []);
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
  assert.equal(rows.length, 1);
  assert.equal(rows[0].broker, 'zerodha');
  assert.equal(rows[0].broker_user_id, 'AAA111');
  assert.equal(rows[0].has_api_key, 1);
  assert.equal(rows[0].has_access_token, 1);
  assert.equal(rows[0].has_totp, 1);
  // Sealed payloads should NOT appear in the list response
  assert.equal(rows[0].api_key, undefined);
  assert.equal(rows[0].access_token, undefined);
});

test('getFull returns sealed payloads (only for backend use)', () => {
  const row = db.brokers.getByBroker(userA.id, 'zerodha');
  const full = db.brokers.getFull(userA.id, row.id);
  assert.equal(full.api_key, 'SEALED_KEY_A');
  assert.equal(full.access_token, 'SEALED_TOKEN_A');
  assert.equal(full.totp_seed, 'SEALED_TOTP_A');
});

test('isolation: user B cannot see user A row', () => {
  assert.deepEqual(db.brokers.list(userB.id), []);
  const aRow = db.brokers.getByBroker(userA.id, 'zerodha');
  assert.equal(db.brokers.getFull(userB.id, aRow.id), undefined);
});

test('isolation: user B has own row, separate from A', () => {
  db.brokers.upsert({
    user_id: userB.id,
    broker: 'zerodha',
    broker_user_id: 'BBB222',
    api_key: 'SEALED_KEY_B',
    is_default: true,
  });
  assert.equal(db.brokers.list(userA.id)[0].broker_user_id, 'AAA111');
  assert.equal(db.brokers.list(userB.id)[0].broker_user_id, 'BBB222');
});

test('upsert with partial fields merges via COALESCE (does NOT null out missing fields)', () => {
  db.brokers.upsert({
    user_id: userA.id,
    broker: 'zerodha',
    broker_user_id: 'AAA111',
    api_key: 'NEW_SEALED_KEY',
    is_default: true,
  });
  const aRow = db.brokers.getByBroker(userA.id, 'zerodha');
  const full = db.brokers.getFull(userA.id, aRow.id);
  assert.equal(full.api_key, 'NEW_SEALED_KEY');
  assert.equal(full.access_token, 'SEALED_TOKEN_A');      // unchanged
  assert.equal(full.refresh_token, 'SEALED_SECRET_A');    // unchanged
  assert.equal(full.totp_seed, 'SEALED_TOTP_A');          // unchanged
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
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].broker, 'dhan');
});

test('delete removes the row', () => {
  const dhanRow = db.brokers.getByBroker(userA.id, 'dhan');
  const result = db.brokers.delete(userA.id, dhanRow.id);
  assert.equal(result.changes, 1);
  assert.equal(db.brokers.getByBroker(userA.id, 'dhan'), undefined);
});

test('delete is isolated: A cannot delete B row', () => {
  const bRow = db.brokers.getByBroker(userB.id, 'zerodha');
  const result = db.brokers.delete(userA.id, bRow.id);
  assert.equal(result.changes, 0);
  assert.notEqual(db.brokers.getByBroker(userB.id, 'zerodha'), undefined);
});

test('ON DELETE CASCADE: deleting user removes their broker_accounts', () => {
  db._conn.prepare('DELETE FROM users WHERE id = ?').run(userB.id);
  assert.deepEqual(db.brokers.list(userB.id), []);
});

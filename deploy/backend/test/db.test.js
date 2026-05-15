const { test } = require('node:test');
const assert = require('node:assert/strict');
const path  = require('path');
const fs    = require('fs');
const os    = require('os');

// Point db.js at a temp file and point require resolution at our installed dep.
const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === 'better-sqlite3') return require.resolve('/tmp/sqlite-test/node_modules/better-sqlite3');
  return origResolve.call(this, req, ...rest);
};

// Use a fresh temp path per test run.
const TMP = path.join(os.tmpdir(), 'ats-db-' + Date.now() + '.db');
process.env.ATS_DB_PATH = TMP;
const { open, close } = require('../db');

test('open() creates the file + applies schema', () => {
  const db = open({ path: TMP });
  // Schema version recorded
  const v = db._conn.prepare('SELECT version FROM _schema_version ORDER BY version DESC LIMIT 1').get();
  assert.equal(v.version, 1);
  // Users table exists + is empty
  assert.equal(db.users.count(), 0);
});

test('users.create + byEmail roundtrip', () => {
  const db = open();
  db.users.create({ email: 'me@test.com', password_hash: 'hash', name: 'Me', verification_token: 'tok', verification_sent_at: null });
  const u = db.users.byEmail('me@test.com');
  assert.equal(u.email, 'me@test.com');
  assert.equal(u.name, 'Me');
  assert.equal(u.is_verified, 0);
  assert.equal(u.is_admin, 0);
  // byVerifyToken
  const u2 = db.users.byVerifyToken('tok');
  assert.equal(u2.id, u.id);
});

test('email uniqueness enforced case-insensitively', () => {
  const db = open();
  assert.throws(() =>
    db.users.create({ email: 'ME@test.com', password_hash: 'h', name: 'X', verification_token: null, verification_sent_at: null }),
    /UNIQUE/);
});

test('users.markVerified clears the token', () => {
  const db = open();
  const u = db.users.byEmail('me@test.com');
  db.users.markVerified(u.id);
  const u2 = db.users.byId(u.id);
  assert.equal(u2.is_verified, 1);
  assert.equal(u2.verification_token, null);
});

test('users.touchLogin updates last_login_at and resets failed_logins', () => {
  const db = open();
  const u = db.users.byEmail('me@test.com');
  db.users.bumpFailed(u.id);
  db.users.bumpFailed(u.id);
  assert.equal(db.users.byId(u.id).failed_logins, 2);
  db.users.touchLogin(u.id);
  assert.equal(db.users.byId(u.id).failed_logins, 0);
  assert.ok(db.users.byId(u.id).last_login_at);
});

test('sessions: create + get + delete + purge', () => {
  const db = open();
  const u = db.users.byEmail('me@test.com');
  const sid = 'sess-' + Date.now();
  const future = new Date(Date.now() + 60_000).toISOString().slice(0, 19).replace('T', ' ');
  db.sessions.create(sid, u.id, future, '127.0.0.1', 'ua-test');
  const s = db.sessions.get(sid);
  assert.equal(s.user_id, u.id);
  assert.equal(s.email, 'me@test.com');
  db.sessions.delete(sid);
  assert.equal(db.sessions.get(sid), undefined);
});

test('sessions: expired sessions are not returned', () => {
  const db = open();
  const u = db.users.byEmail('me@test.com');
  const sid = 'sess-expired';
  const past = new Date(Date.now() - 60_000).toISOString().slice(0, 19).replace('T', ' ');
  db.sessions.create(sid, u.id, past, '', '');
  assert.equal(db.sessions.get(sid), undefined);
  // purgeExpired removes it
  const removed = db.sessions.purgeExpired();
  assert.ok(removed >= 1);
});

test('watchlist: add/list/remove + per-user isolation', () => {
  const db = open();
  const u = db.users.byEmail('me@test.com');
  // second user to prove isolation
  db.users.create({ email: 'other@test.com', password_hash: 'h', name: 'O', verification_token: null, verification_sent_at: null });
  const o = db.users.byEmail('other@test.com');

  db.watchlist.add(u.id, 'RELIANCE');
  db.watchlist.add(u.id, 'HDFCBANK');
  db.watchlist.add(o.id, 'INFY');

  const myList = db.watchlist.list(u.id).map(r => r.symbol);
  const otherList = db.watchlist.list(o.id).map(r => r.symbol);
  assert.deepEqual(myList.sort(), ['HDFCBANK', 'RELIANCE']);
  assert.deepEqual(otherList, ['INFY']);

  db.watchlist.remove(u.id, 'HDFCBANK');
  assert.deepEqual(db.watchlist.list(u.id).map(r => r.symbol), ['RELIANCE']);
});

test('foreign-key cascade: deleting a user removes their watchlist', () => {
  const db = open();
  const o = db.users.byEmail('other@test.com');
  db._conn.prepare('DELETE FROM users WHERE id = ?').run(o.id);
  assert.equal(db.watchlist.list(o.id).length, 0);
});

test('promoteFirstToAdmin makes the first user admin + verified', () => {
  const db = open();
  db.users.promoteFirstToAdmin();
  const me = db.users.byEmail('me@test.com');
  assert.equal(me.is_admin, 1);
  assert.equal(me.is_verified, 1);
});

test('transaction: atomic batch insert', () => {
  const db = open();
  const before = db.watchlist.list(db.users.byEmail('me@test.com').id).length;
  db.transaction(() => {
    db.watchlist.add(db.users.byEmail('me@test.com').id, 'TCS');
    db.watchlist.add(db.users.byEmail('me@test.com').id, 'INFY');
  });
  const after = db.watchlist.list(db.users.byEmail('me@test.com').id).length;
  assert.equal(after, before + 2);
});

test('cleanup: close the db', () => {
  close();
  fs.unlinkSync(TMP);
});

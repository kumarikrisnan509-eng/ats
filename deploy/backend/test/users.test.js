const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const os = require('os');
const fs = require('fs');

const Module = require('module');
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (req, ...rest) {
  if (req === 'better-sqlite3') return require.resolve('/tmp/sqlite-test/node_modules/better-sqlite3');
  if (req === 'bcrypt')         return require.resolve('/tmp/sqlite-test/node_modules/bcrypt');
  return origResolve.call(this, req, ...rest);
};

const TMP = path.join(os.tmpdir(), 'ats-users-' + Date.now() + '.db');
process.env.ATS_DB_PATH = TMP;
process.env.BCRYPT_COST = '4';  // speed up tests (still safe in tests)
const { open, close } = require('../db');
const { createUsers } = require('../users');

const db = open({ path: TMP });
const auth = createUsers({ db, audit: () => {} });

test('signup: first user becomes admin + verified', async () => {
  const { user } = await auth.signup({ email: 'admin@test.com', password: 'password123', name: 'Admin' });
  assert.equal(user.is_admin, 1);
  assert.equal(user.is_verified, 1);
});

test('signup: second user is not admin, needs verification', async () => {
  const { user, verifyToken } = await auth.signup({ email: 'user@test.com', password: 'password123', name: 'User' });
  assert.equal(user.is_admin, 0);
  assert.equal(user.is_verified, 0);
  assert.equal(typeof verifyToken, 'string');
  assert.equal(verifyToken.length, 64);
});

test('signup: duplicate email rejected', async () => {
  await assert.rejects(auth.signup({ email: 'admin@test.com', password: 'password123', name: 'X' }), /already registered/);
});

test('signup: invalid email rejected', async () => {
  await assert.rejects(auth.signup({ email: 'not-an-email', password: 'password123', name: 'X' }), /invalid email/);
});

test('signup: short password rejected', async () => {
  await assert.rejects(auth.signup({ email: 'short@test.com', password: 'short', name: 'X' }), /at least 8 chars/);
});

test('login: success returns sessionId + user', async () => {
  const r = await auth.login({ email: 'admin@test.com', password: 'password123', ip: '1.2.3.4', ua: 'curl/8' });
  assert.equal(typeof r.sessionId, 'string');
  assert.equal(r.sessionId.length, 64);
  assert.equal(r.user.email, 'admin@test.com');
  // Session is queryable
  const s = auth.getSession(r.sessionId);
  assert.equal(s.user_id, r.user.id);
  assert.equal(s.email, 'admin@test.com');
});

test('login: wrong password rejected', async () => {
  await assert.rejects(auth.login({ email: 'admin@test.com', password: 'wrong-password' }), /invalid credentials/);
});

test('login: unknown email rejected with same message', async () => {
  await assert.rejects(auth.login({ email: 'noone@test.com', password: 'whatever' }), /invalid credentials/);
});

test('login: 5 wrong attempts lock the account 15 min', async () => {
  for (let i = 0; i < 4; i++) {
    try { await auth.login({ email: 'user@test.com', password: 'wrong' }); } catch (_) {}
  }
  // 5th attempt -> lock
  await assert.rejects(auth.login({ email: 'user@test.com', password: 'wrong' }), /too many failed|locked/);
  // Even with correct password, account is now locked
  await assert.rejects(auth.login({ email: 'user@test.com', password: 'password123' }), /locked/);
});

test('logout: deletes the session', async () => {
  const r = await auth.login({ email: 'admin@test.com', password: 'password123' });
  auth.logout(r.sessionId);
  assert.equal(auth.getSession(r.sessionId), null);
});

test('optionalAuth attaches req.user when cookie present', () => {
  return (async () => {
    const r = await auth.login({ email: 'admin@test.com', password: 'password123' });
    const req = { headers: { cookie: `ats_sid=${r.sessionId}` } };
    const res = {};
    let nextCalled = false;
    auth.optionalAuth(req, res, () => { nextCalled = true; });
    assert.equal(nextCalled, true);
    assert.equal(req.user.email, 'admin@test.com');
    assert.equal(req.user.is_admin, true);
  })();
});

test('requireAuth blocks unauthenticated requests with 401', () => {
  const req = { headers: {} };
  let status = 200, body = null;
  const res = { status(c) { status = c; return this; }, json(o) { body = o; return this; } };
  auth.optionalAuth(req, res, () => {
    auth.requireAuth(req, res, () => assert.fail('should not reach next()'));
  });
  assert.equal(status, 401);
  assert.equal(body.reason, 'auth_required');
});

test('requireAdmin blocks non-admin with 403', () => {
  return (async () => {
    const r = await auth.login({ email: 'user@test.com', password: 'password123' }).catch(async () => {
      // Account is locked from earlier test -- unlock + re-try
      db._conn.prepare('UPDATE users SET locked_until = NULL, failed_logins = 0 WHERE email = ?').run('user@test.com');
      return await auth.login({ email: 'user@test.com', password: 'password123' });
    });
    const req = { headers: { cookie: `ats_sid=${r.sessionId}` } };
    let status = 200, body = null;
    const res = { status(c) { status = c; return this; }, json(o) { body = o; return this; } };
    auth.optionalAuth(req, res, () => {
      auth.requireAdmin(req, res, () => assert.fail('non-admin reached admin route'));
    });
    assert.equal(status, 403);
    assert.equal(body.reason, 'admin_only');
  })();
});

test('cleanup', () => { close(); fs.unlinkSync(TMP); });

// === Tier 51 tests: verify + password reset ===
const path2 = require('path');
const fs2 = require('fs');

test('verifyEmail: valid token marks user verified', async () => {
  // Need a fresh DB for this since the earlier 'cleanup' test closed it
  const TMP2 = path2.join(require('os').tmpdir(), 'ats-users2-' + Date.now() + '.db');
  process.env.ATS_DB_PATH = TMP2;
  delete require.cache[require.resolve('../db')];
  delete require.cache[require.resolve('../users')];
  const { open: open2, close: close2 } = require('../db');
  const { createUsers: cu2 } = require('../users');
  const db2 = open2({ path: TMP2 });
  const auth2 = cu2({ db: db2, audit: () => {} });

  await auth2.signup({ email: 'admin2@test.com', password: 'password123', name: 'A' });
  const { verifyToken } = await auth2.signup({ email: 'second@test.com', password: 'password123', name: 'S' });
  const v = await auth2.verifyEmail(verifyToken);
  assert.equal(v.user.is_verified, 1);
  assert.equal(v.alreadyVerified, false);

  // Second call should be a no-op (token cleared)
  await assert.rejects(auth2.verifyEmail(verifyToken), /invalid or expired/);

  // Password reset roundtrip
  const r = await auth2.requestPasswordReset({ email: 'second@test.com' });
  assert.equal(r.ok, true);
  assert.equal(typeof r.token, 'string');
  // Wrong token rejected
  await assert.rejects(auth2.resetPassword({ token: 'bogus', newPassword: 'newpass123' }), /invalid or expired/);
  // Right token works
  const done = await auth2.resetPassword({ token: r.token, newPassword: 'newpass123' });
  assert.equal(done.ok, true);
  // Old password no longer works
  await assert.rejects(auth2.login({ email: 'second@test.com', password: 'password123' }), /invalid credentials/);
  // New password works
  const ok = await auth2.login({ email: 'second@test.com', password: 'newpass123' });
  assert.equal(ok.user.email, 'second@test.com');

  // requestPasswordReset for unknown email returns ok (anti-enumeration)
  const unk = await auth2.requestPasswordReset({ email: 'noone@example.com' });
  assert.equal(unk.ok, true);
  assert.equal(unk.sent, false);

  close2();
  fs2.unlinkSync(TMP2);
});

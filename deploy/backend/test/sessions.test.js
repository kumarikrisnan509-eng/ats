// sessions.test.js — T-148 regression guard for sessions.js.
//
// SessionStore is the in-memory cookie→userId mapping AND the sealed-token
// persistence layer at /var/lib/ats/tokens/<userId>.enc. It's the cross-VM
// data layer for v1 single-tenant operator deployment; per-user OAuth tokens
// live here when the operator hasn't migrated to broker_accounts yet.
//
// A regression in saveTokens/loadTokens silently kills the operator's
// in-memory access_token recovery on server restart. A regression in
// listAllUserIds() that fails to filter the underscore prefix would cause
// cron-reauth to try sealing/exchanging the operator's static login creds
// as if they were a Kite session — junk Kite errors.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Vault, writeNewMasterKey } = require('../crypto-vault');
const { SessionStore } = require('../sessions');

// ---------- fixtures ----------
async function freshStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-sessions-test-'));
  const tokensDir = path.join(dir, 'tokens');
  const keyPath = path.join(dir, 'master.key');
  await writeNewMasterKey(keyPath);
  const vault = await Vault.open(keyPath);
  const store = new SessionStore({ tokensDir, vault });
  return { store, tokensDir };
}

// ---------- session ID lifecycle ----------

test('newSession returns a unique base64url id and stores the userId mapping', async () => {
  const { store } = await freshStore();
  const a = store.newSession('user_a');
  const b = store.newSession('user_b');

  assert.notEqual(a, b, 'two newSession calls must return different ids');
  assert.match(a, /^[A-Za-z0-9_-]+$/, 'id must be base64url (no padding, no slashes)');
  // 32 random bytes → base64url length 43 (no padding)
  assert.equal(a.length, 43);

  assert.equal(store.userIdFor(a), 'user_a');
  assert.equal(store.userIdFor(b), 'user_b');
});

test('userIdFor returns null for unknown session ids', async () => {
  const { store } = await freshStore();
  assert.equal(store.userIdFor('nope'), null);
  assert.equal(store.userIdFor(''), null);
});

test('destroy removes the mapping', async () => {
  const { store } = await freshStore();
  const id = store.newSession('user_c');
  assert.equal(store.userIdFor(id), 'user_c');
  store.destroy(id);
  assert.equal(store.userIdFor(id), null);
});

test('newSession generates 43-char base64url ids with sufficient entropy', async () => {
  const { store } = await freshStore();
  const seen = new Set();
  for (let i = 0; i < 200; i++) {
    seen.add(store.newSession('u'));
  }
  // 200 unique 256-bit random ids — collisions are astronomically improbable.
  assert.equal(seen.size, 200, 'session ids must be unique across 200 generations');
});

// ---------- saveTokens / loadTokens roundtrip ----------

test('saveTokens + loadTokens roundtrips the payload through libsodium', async () => {
  const { store } = await freshStore();
  const payload = {
    accessToken: 'kite_access_token_xyz',
    publicToken: 'pub_token_abc',
    userId: 'ARS209',
    issuedAt: '2026-05-18T03:42:00Z',
  };
  await store.saveTokens('ARS209', payload);
  const loaded = await store.loadTokens('ARS209');
  assert.deepEqual(loaded, payload);
});

test('loadTokens returns null when no file exists', async () => {
  const { store } = await freshStore();
  const r = await store.loadTokens('never_saved');
  assert.equal(r, null);
});

test('saveTokens writes the file with mode 0600', async () => {
  const { store, tokensDir } = await freshStore();
  await store.saveTokens('USER1', { accessToken: 'x' });
  const stat = fs.statSync(path.join(tokensDir, 'USER1.enc'));
  assert.equal(stat.mode & 0o777, 0o600);
});

test('forgetTokens deletes the file (idempotent if missing)', async () => {
  const { store, tokensDir } = await freshStore();
  await store.saveTokens('USER1', { accessToken: 'x' });
  assert.ok(fs.existsSync(path.join(tokensDir, 'USER1.enc')));

  await store.forgetTokens('USER1');
  assert.ok(!fs.existsSync(path.join(tokensDir, 'USER1.enc')));

  // Calling again must not throw.
  await store.forgetTokens('USER1');
  await store.forgetTokens('nonexistent');
});

// ---------- listAllUserIds ----------

test('listAllUserIds returns saved userIds without the .enc extension', async () => {
  const { store } = await freshStore();
  await store.saveTokens('alice', { accessToken: 'a' });
  await store.saveTokens('bob',   { accessToken: 'b' });

  const ids = store.listAllUserIds();
  assert.equal(ids.length, 2);
  assert.ok(ids.includes('alice'));
  assert.ok(ids.includes('bob'));
});

test('listAllUserIds filters out leading-underscore files (_zerodha-login.enc)', async () => {
  // The operator's static auto-login creds are stored at
  //   /var/lib/ats/tokens/_zerodha-login.enc
  // (LoginVault path, T-147). If listAllUserIds() ever leaks that filename
  // back as a userId, cron-reauth tries to exchange it against Kite and
  // we get garbage errors.
  const { store, tokensDir } = await freshStore();
  await store.saveTokens('alice', { accessToken: 'a' });
  // Drop a sibling underscore-prefixed file manually.
  fs.writeFileSync(path.join(tokensDir, '_zerodha-login.enc'), 'sealedblob', { mode: 0o600 });

  const ids = store.listAllUserIds();
  assert.deepEqual(ids, ['alice']);
  assert.ok(!ids.some(i => i.startsWith('_')));
});

test('listAllUserIds returns empty array when tokensDir does not exist', async () => {
  const { store, tokensDir } = await freshStore();
  fs.rmSync(tokensDir, { recursive: true, force: true });
  assert.deepEqual(store.listAllUserIds(), []);
});

// ---------- userId sanitization ----------

test('_tokenPath sanitises userId — no path traversal via slash/dotdot', async () => {
  const { store, tokensDir } = await freshStore();
  // The store should sanitise '../../../etc/passwd' to a safe filename
  // that stays inside tokensDir.
  await store.saveTokens('../../../etc/passwd', { accessToken: 'x' });

  // Resulting file must be inside tokensDir.
  const files = fs.readdirSync(tokensDir);
  assert.equal(files.length, 1);
  // No slashes or dots in the resulting filename.
  assert.ok(!files[0].includes('/'),  `sanitised filename must not contain '/': ${files[0]}`);
  // The dot in '.enc' is allowed, but no '../' sequence
  assert.ok(!files[0].includes('..'), `sanitised filename must not contain '..': ${files[0]}`);
  // Confirm /etc/passwd was NOT touched
  assert.ok(!fs.existsSync('/etc/passwd.enc'), 'must not write outside tokensDir');
});

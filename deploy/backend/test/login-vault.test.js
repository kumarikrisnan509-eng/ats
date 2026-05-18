// login-vault.test.js — T-147 regression guard for login-vault.js.
//
// LoginVault stores the OPERATOR's own Zerodha credentials (userId,
// password, totpSeed) at /var/lib/ats/tokens/_zerodha-login.enc, sealed
// with the libsodium master key. It's consumed by:
//   - /api/brokers/zerodha/auto-login/bundle (the legacy single-account auto-login)
//   - host-side zerodha-auto-login.js script
//
// A regression that breaks save/load roundtrip silently kills the operator's
// own daily auto-reauth. Per-user reauth (T-133/T-138) is unaffected — it
// uses broker_accounts rows directly, not LoginVault.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Vault, writeNewMasterKey } = require('../crypto-vault');
const { LoginVault, LOGIN_VAULT_PATH } = require('../login-vault');

// ---------- fixtures ----------
async function freshVault() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-login-vault-test-'));
  const keyPath = path.join(dir, 'master.key');
  await writeNewMasterKey(keyPath);
  const vault = await Vault.open(keyPath);
  return { vault, dir };
}

function tmpVaultPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-login-vault-test-'));
  return path.join(dir, '_zerodha-login.enc');
}

// ---------- module exports ----------

test('exports LoginVault class and LOGIN_VAULT_PATH default', () => {
  assert.equal(typeof LoginVault, 'function');
  assert.equal(typeof LOGIN_VAULT_PATH, 'string');
  // Default path lives under the bind-mounted tokens dir.
  assert.ok(LOGIN_VAULT_PATH.includes('zerodha-login.enc'));
});

// ---------- save / load roundtrip ----------

test('save + load roundtrips userId, password, totpSeed', async () => {
  const { vault } = await freshVault();
  const p = tmpVaultPath();
  const lv = new LoginVault(vault, p);

  await lv.save({ userId: 'ARS209', password: 'p@ssw0rd!', totpSeed: 'JBSWY3DPEHPK3PXP' });
  const loaded = await lv.load();

  assert.equal(loaded.userId, 'ARS209');
  assert.equal(loaded.password, 'p@ssw0rd!');
  assert.equal(loaded.totpSeed, 'JBSWY3DPEHPK3PXP');
  assert.ok(loaded.sealedAt, 'sealedAt timestamp must be set');
  assert.ok(new Date(loaded.sealedAt) <= new Date(), 'sealedAt must be in the past');
});

test('save strips whitespace + uppercases the totpSeed', async () => {
  const { vault } = await freshVault();
  const lv = new LoginVault(vault, tmpVaultPath());

  // Kite's TOTP setup screen pastes the seed with spaces every 4 chars and
  // sometimes lowercase. Save must normalize to BASE32 canonical form so
  // otplib accepts it.
  await lv.save({
    userId:   'ARS209',
    password: 'pw',
    totpSeed: 'jbswy 3dpe hpk3 pxp',
  });
  const loaded = await lv.load();
  assert.equal(loaded.totpSeed, 'JBSWY3DPEHPK3PXP');
});

test('save throws on missing fields', async () => {
  const { vault } = await freshVault();
  const lv = new LoginVault(vault, tmpVaultPath());

  await assert.rejects(
    () => lv.save({ password: 'pw', totpSeed: 's' }),
    /userId, password, totpSeed all required/
  );
  await assert.rejects(
    () => lv.save({ userId: 'u', totpSeed: 's' }),
    /userId, password, totpSeed all required/
  );
  await assert.rejects(
    () => lv.save({ userId: 'u', password: 'pw' }),
    /userId, password, totpSeed all required/
  );
  await assert.rejects(
    () => lv.save({ userId: '', password: 'pw', totpSeed: 's' }),
    /required/
  );
});

// ---------- exists ----------

test('exists() returns false before save, true after', async () => {
  const { vault } = await freshVault();
  const p = tmpVaultPath();
  const lv = new LoginVault(vault, p);

  assert.equal(lv.exists(), false, 'should not exist before save');
  await lv.save({ userId: 'u', password: 'pw', totpSeed: 's' });
  assert.equal(lv.exists(), true, 'should exist after save');
});

// ---------- load failure modes ----------

test('load throws helpful message when no creds file exists', async () => {
  const { vault } = await freshVault();
  const lv = new LoginVault(vault, tmpVaultPath());
  await assert.rejects(
    () => lv.load(),
    /no creds.*install-zerodha-creds/
  );
});

test('load throws when sealed blob was created with a different master key', async () => {
  const { vault: v1 } = await freshVault();
  const { vault: v2 } = await freshVault();
  const p = tmpVaultPath();

  const lv1 = new LoginVault(v1, p);
  await lv1.save({ userId: 'u', password: 'pw', totpSeed: 's' });

  // Now try to open with a different vault.
  const lv2 = new LoginVault(v2, p);
  await assert.rejects(
    () => lv2.load(),
    /decryption failed|wrong secret key/i
  );
});

// ---------- file permissions ----------

test('save writes the sealed file with mode 0600', async () => {
  const { vault } = await freshVault();
  const p = tmpVaultPath();
  const lv = new LoginVault(vault, p);
  await lv.save({ userId: 'u', password: 'pw', totpSeed: 's' });

  const stat = fs.statSync(p);
  // 0600 = rw-------. Mask off file-type bits.
  assert.equal(stat.mode & 0o777, 0o600,
    `mode should be 0600, got ${(stat.mode & 0o777).toString(8)}`);
});

test('save creates the parent directory if missing', async () => {
  const { vault } = await freshVault();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-login-vault-test-'));
  const nested = path.join(dir, 'nested', 'deeper', '_creds.enc');
  const lv = new LoginVault(vault, nested);

  await lv.save({ userId: 'u', password: 'pw', totpSeed: 's' });
  assert.ok(fs.existsSync(nested));
});

// ---------- ciphertext-on-disk sanity ----------

test('sealed file on disk does not contain plaintext userId/password/totpSeed', async () => {
  const { vault } = await freshVault();
  const p = tmpVaultPath();
  const lv = new LoginVault(vault, p);
  await lv.save({
    userId:   'ARS209',
    password: 'verySecretPassword!',
    totpSeed: 'BASE32SEEDXYZ',
  });

  // Read raw bytes from disk and assert no field appears as plaintext.
  // (libsodium ciphertext is high-entropy; this is a sanity floor, not
  // a security proof.)
  const raw = fs.readFileSync(p, 'utf8');
  assert.ok(!raw.includes('ARS209'),         'userId leaked as plaintext on disk');
  assert.ok(!raw.includes('verySecretPassword!'), 'password leaked as plaintext on disk');
  assert.ok(!raw.includes('BASE32SEEDXYZ'),  'totpSeed leaked as plaintext on disk');
});

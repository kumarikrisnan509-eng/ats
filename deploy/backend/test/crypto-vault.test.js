// crypto-vault.test.js — T-146 regression guard for crypto-vault.js.
//
// crypto-vault.Vault is the foundation that protects every user's Kite
// credentials (api_key, api_secret, totp_seed, password, access_token) at
// rest in broker_accounts. T-133 (bulk-rotate route) and T-138 (host
// rotation script) both pivot through it via vault.seal() / vault.open().
//
// A regression in the seal/open contract silently makes every user's
// stored credentials unrecoverable — the next cron-reauth run fails for
// everyone with 'decryption failed'.
//
// These tests roundtrip seal/open against a fresh master key in a tmpdir
// so they need no external state and run in milliseconds.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Vault, writeNewMasterKey } = require('../crypto-vault');

// ---------- fixtures ----------
function tmpKeyPath() {
  return path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ats-vault-test-')),
    'master.key'
  );
}

// ---------- writeNewMasterKey ----------

test('writeNewMasterKey creates a 32-byte file with 0400 perms', async () => {
  const p = tmpKeyPath();
  await writeNewMasterKey(p);
  const stat = fs.statSync(p);
  assert.equal(stat.size, 32, 'master key must be 32 bytes (libsodium secretbox key)');
  // chmod 0400 = -r-------- (owner read only). Mask with 0o777 to ignore
  // file-type bits.
  assert.equal(stat.mode & 0o777, 0o400, `mode should be 0400, got ${(stat.mode & 0o777).toString(8)}`);
});

test('writeNewMasterKey generates different keys each call', async () => {
  const p1 = tmpKeyPath();
  const p2 = tmpKeyPath();
  await writeNewMasterKey(p1);
  await writeNewMasterKey(p2);
  const k1 = fs.readFileSync(p1);
  const k2 = fs.readFileSync(p2);
  assert.notDeepEqual(k1, k2, 'two master keys should differ (catastrophic if equal)');
});

// ---------- Vault.open + seal/open roundtrip ----------

test('Vault.open loads a master key from disk', async () => {
  const p = tmpKeyPath();
  await writeNewMasterKey(p);
  const v = await Vault.open(p);
  assert.ok(v instanceof Vault);
});

test('seal/open roundtrip preserves the plaintext exactly', async () => {
  const p = tmpKeyPath();
  await writeNewMasterKey(p);
  const v = await Vault.open(p);

  const samples = [
    'simple',
    'with spaces and punctuation, like an API key.',
    '🔐 unicode-heavy ✨ totp seeds',
    'base32-style: JBSWY3DPEHPK3PXP',
    '',  // edge case — empty string
    'a'.repeat(1024),  // long
  ];
  for (const pt of samples) {
    if (pt === '') {
      // libsodium secretbox accepts empty plaintext; verify roundtrip works.
      const sealed = await v.seal(pt);
      const opened = await v.open(sealed);
      assert.equal(opened, pt);
    } else {
      const sealed = await v.seal(pt);
      const opened = await v.open(sealed);
      assert.equal(opened, pt, `roundtrip failed for: ${pt.slice(0, 40)}…`);
    }
  }
});

test('seal produces different ciphertext on repeated calls (nonce randomness)', async () => {
  // Two seal() calls of the SAME plaintext MUST produce different ciphertexts
  // because the nonce is random. If they ever match, the nonce has been
  // accidentally fixed (catastrophic — enables replay attacks).
  const p = tmpKeyPath();
  await writeNewMasterKey(p);
  const v = await Vault.open(p);

  const pt = 'kite-access-token-abc123';
  const a = await v.seal(pt);
  const b = await v.seal(pt);
  assert.notEqual(a, b, 'repeated seal() must produce different ciphertexts');

  // Both must still open to the same plaintext.
  assert.equal(await v.open(a), pt);
  assert.equal(await v.open(b), pt);
});

test('sealed ciphertext is base64-encoded and >= 24 bytes (nonce + tag minimum)', async () => {
  const p = tmpKeyPath();
  await writeNewMasterKey(p);
  const v = await Vault.open(p);

  const sealed = await v.seal('test');
  // Must be base64. Decode without throwing.
  const raw = Buffer.from(sealed, 'base64');
  // nonce (24) + auth tag (16) + 4-byte plaintext = 44 bytes minimum
  assert.ok(raw.length >= 24, `sealed blob too short: ${raw.length}`);
  // Re-encode + compare round-trips cleanly (no padding weirdness)
  assert.equal(raw.toString('base64'), sealed);
});

// ---------- failure modes ----------

test('open rejects ciphertext sealed by a different master key', async () => {
  const p1 = tmpKeyPath();
  const p2 = tmpKeyPath();
  await writeNewMasterKey(p1);
  await writeNewMasterKey(p2);
  const v1 = await Vault.open(p1);
  const v2 = await Vault.open(p2);

  const sealed = await v1.seal('secret');
  await assert.rejects(
    () => v2.open(sealed),
    /decryption failed|wrong secret key/i,
    'wrong-key open must throw, not return garbage'
  );
});

test('open rejects tampered ciphertext (flip one byte)', async () => {
  const p = tmpKeyPath();
  await writeNewMasterKey(p);
  const v = await Vault.open(p);

  const sealed = await v.seal('confidential');
  // Flip a single byte well past the nonce (in the ciphertext region).
  const buf = Buffer.from(sealed, 'base64');
  buf[buf.length - 1] ^= 0xff;
  const tampered = buf.toString('base64');
  await assert.rejects(
    () => v.open(tampered),
    /decryption failed|wrong secret key/i,
    'tampered ciphertext must throw (libsodium MAC catches it)'
  );
});

test('open rejects truncated ciphertext (too short for nonce)', async () => {
  const p = tmpKeyPath();
  await writeNewMasterKey(p);
  const v = await Vault.open(p);

  // 'aaaa' base64-decodes to 3 bytes — well under the 24-byte nonce.
  await assert.rejects(
    () => v.open('aaaa'),
    /too short|decryption failed/i
  );
});

test('Vault.open throws on missing master key file', async () => {
  const bogus = path.join(os.tmpdir(), 'this-file-does-not-exist-' + Date.now());
  await assert.rejects(() => Vault.open(bogus), /ENOENT|no such file/i);
});

test('Vault.open throws on wrong-length master key', async () => {
  const p = path.join(
    fs.mkdtempSync(path.join(os.tmpdir(), 'ats-vault-test-')),
    'bad.key'
  );
  fs.writeFileSync(p, Buffer.alloc(16));  // 16 bytes — half the required length
  await assert.rejects(() => Vault.open(p), /master key length mismatch|length/i);
});

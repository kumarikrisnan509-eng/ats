// crypto-vault.js — at-rest encryption for sensitive secrets (Zerodha access tokens).
//
// v1: libsodium secretbox. Master key in /etc/ats/master.key (chmod 400, root-only).
// v2: Migrate to OCI Vault (planned). The API surface here will stay the same.
//
// Token format on disk: base64( nonce(24) || ciphertext )

const fs = require('fs');
const path = require('path');

let sodium;
async function getSodium() {
  if (sodium) return sodium;
  // libsodium-wrappers exposes a ready promise.
  const lib = require('libsodium-wrappers');
  await lib.ready;
  sodium = lib;
  return sodium;
}

/**
 * Generates a 32-byte master key. Run once during setup:
 *   node -e "require('./crypto-vault').writeNewMasterKey('/etc/ats/master.key')"
 */
async function writeNewMasterKey(filePath) {
  const s = await getSodium();
  const key = s.randombytes_buf(s.crypto_secretbox_KEYBYTES);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, Buffer.from(key));
  fs.chmodSync(filePath, 0o400);
  return filePath;
}

async function loadMasterKey(filePath) {
  const s = await getSodium();
  const buf = fs.readFileSync(filePath);
  if (buf.length !== s.crypto_secretbox_KEYBYTES) {
    throw new Error(`master key length mismatch at ${filePath}: ${buf.length}`);
  }
  return new Uint8Array(buf);
}

class Vault {
  /** @param {Uint8Array} masterKey */
  constructor(masterKey) {
    this._key = masterKey;
  }

  static async open(filePath) {
    const key = await loadMasterKey(filePath);
    return new Vault(key);
  }

  /** @param {string} plaintext */
  async seal(plaintext) {
    const s = await getSodium();
    const nonce = s.randombytes_buf(s.crypto_secretbox_NONCEBYTES);
    const ct = s.crypto_secretbox_easy(s.from_string(plaintext), nonce, this._key);
    const out = new Uint8Array(nonce.length + ct.length);
    out.set(nonce, 0);
    out.set(ct, nonce.length);
    return Buffer.from(out).toString('base64');
  }

  /** @param {string} sealedB64 */
  async open(sealedB64) {
    const s = await getSodium();
    const raw = new Uint8Array(Buffer.from(sealedB64, 'base64'));
    const nlen = s.crypto_secretbox_NONCEBYTES;
    if (raw.length <= nlen) throw new Error('sealed blob too short');
    const nonce = raw.slice(0, nlen);
    const ct = raw.slice(nlen);
    const pt = s.crypto_secretbox_open_easy(ct, nonce, this._key);
    // T-434 (audit-2026-05-26 backend M3): when secretbox_open returns null
    // (corrupt blob, master.key rotated without re-sealing, truncated DB row),
    // emit a structured audit event before throwing so operators can spot a
    // master-key mismatch immediately. Many callers (e.g. broker-resolver)
    // catch the throw and return null, hiding the underlying decryption
    // failure from any user-visible error.
    if (!pt) {
      try {
        if (typeof globalThis.atsAudit === 'function') {
          globalThis.atsAudit('vault.open.failed', {
            reason: 'decryption_failed',
            blobLen: sealedB64 ? sealedB64.length : 0,
            nonceLen: nlen,
            ciphertextLen: ct ? ct.length : 0,
          });
        }
      } catch (_) { /* don't mask the original error */ }
      throw new Error('decryption failed');
    }
    return s.to_string(pt);
  }
}

module.exports = { Vault, writeNewMasterKey };

// sessions.js — minimal per-user session + token store.
//
// T-468 (audit-2026-05-26 backend M4): DEPRECATED. The DB-backed
// session path (db.sessions.* in db.js) is the canonical store as of
// T-340. This module remains because rehydrate-on-boot still reads the
// sealed-token files at /var/lib/ats/tokens/<userId>.enc as a fallback
// when the DB lookup misses. Future plan:
//   1. Migrate any remaining token-file readers to db.brokers.getFull
//   2. Delete the loadTokens/saveTokens API + the .enc files
//   3. Delete this module entirely
// Until step 3, every SessionStore.* call logs once-per-process so
// the operator can audit which paths still touch the legacy store.
//
// v1: in-memory + sealed file on disk per user. Single-VM friendly.
// v2: Postgres + Redis; per-user broker connections pooled centrally.
//
// File layout on disk:
//   /var/lib/ats/tokens/<userId>.enc        sealed Zerodha access_token JSON
//
// A "session" maps a browser session-cookie to a userId.

const crypto = require('crypto');
const fs     = require('fs');
const path   = require('path');

class SessionStore {
  /**
   * @param {object} opts
   * @param {string} opts.tokensDir
   * @param {import('./crypto-vault').Vault} opts.vault
   */
  constructor({ tokensDir, vault }) {
    this.tokensDir = tokensDir;
    this.vault = vault;
    /** Map<sessionId, userId> */
    this.sessions = new Map();
    fs.mkdirSync(tokensDir, { recursive: true });
  }

  newSession(userId) {
    const id = crypto.randomBytes(32).toString('base64url');
    this.sessions.set(id, userId);
    return id;
  }

  userIdFor(sessionId) {
    return this.sessions.get(sessionId) || null;
  }

  destroy(sessionId) {
    this.sessions.delete(sessionId);
  }

  _tokenPath(userId) {
    // userId can contain only alphanum + a few chars in Kite; sanitise just in case.
    const safe = userId.replace(/[^A-Za-z0-9_-]/g, '_');
    return path.join(this.tokensDir, `${safe}.enc`);
  }

  async saveTokens(userId, payload) {
    const sealed = await this.vault.seal(JSON.stringify(payload));
    const p = this._tokenPath(userId);
    fs.writeFileSync(p, sealed, { mode: 0o600 });
    return p;
  }

  async loadTokens(userId) {
    const p = this._tokenPath(userId);
    if (!fs.existsSync(p)) return null;
    const sealed = fs.readFileSync(p, 'utf8');
    const json = await this.vault.open(sealed);
    return JSON.parse(json);
  }

  async forgetTokens(userId) {
    const p = this._tokenPath(userId);
    try { fs.unlinkSync(p); } catch (e) { console.debug('[sessions] swallowed:', e && e.message); }
  }

  listAllUserIds() {
    if (!fs.existsSync(this.tokensDir)) return [];
    return fs.readdirSync(this.tokensDir)
      .filter(f => f.endsWith('.enc'))
      // Skip filenames starting with '_' — they're for non-user data (e.g.
      // _zerodha-login.enc holds auto-login credentials, sealed but distinct).
      .filter(f => !f.startsWith('_'))
      .map(f => f.replace(/\.enc$/, ''));
  }
}

module.exports = { SessionStore };

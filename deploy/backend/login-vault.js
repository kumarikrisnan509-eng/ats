// login-vault.js — encrypted storage for Zerodha login credentials.
//
// Uses the same libsodium master key that protects per-user access tokens.
// Stores at /var/lib/ats/secrets/zerodha-login.enc as a single sealed JSON blob:
//   { userId: "ARS209", password: "...", totpSeed: "BASE32SECRET" }
//
// First-time setup: run deploy/scripts/install-zerodha-creds.sh.
// Plaintext credentials live only in memory during the auto-login run.

const fs = require('fs');
const path = require('path');

const LOGIN_VAULT_PATH = process.env.LOGIN_VAULT_PATH || '/var/lib/ats/secrets/zerodha-login.enc';

class LoginVault {
  /** @param {import('./crypto-vault').Vault} vault */
  constructor(vault, vaultPath = LOGIN_VAULT_PATH) {
    this.vault = vault;
    this.path  = vaultPath;
  }

  exists() {
    return fs.existsSync(this.path);
  }

  /**
   * Encrypt+write credentials.
   * @param {{userId: string, password: string, totpSeed: string}} creds
   */
  async save(creds) {
    if (!creds.userId || !creds.password || !creds.totpSeed) {
      throw new Error('LoginVault.save: userId, password, totpSeed all required');
    }
    fs.mkdirSync(path.dirname(this.path), { recursive: true });
    const json = JSON.stringify({
      userId:   String(creds.userId),
      password: String(creds.password),
      totpSeed: String(creds.totpSeed).replace(/\s+/g, '').toUpperCase(),
      sealedAt: new Date().toISOString(),
    });
    const sealed = await this.vault.seal(json);
    fs.writeFileSync(this.path, sealed, { mode: 0o600 });
    return this.path;
  }

  /**
   * Read + decrypt credentials. NEVER persist the returned plaintext.
   * @returns {Promise<{userId, password, totpSeed, sealedAt}>}
   */
  async load() {
    if (!this.exists()) throw new Error(`LoginVault: no creds at ${this.path}. Run install-zerodha-creds.sh.`);
    const sealed = fs.readFileSync(this.path, 'utf8');
    const plain  = await this.vault.open(sealed);
    return JSON.parse(plain);
  }
}

module.exports = { LoginVault, LOGIN_VAULT_PATH };

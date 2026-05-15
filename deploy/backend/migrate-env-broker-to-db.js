#!/usr/bin/env node
// migrate-env-broker-to-db.js -- Tier 57: move env-var Zerodha credentials into DB row.
//
// Usage:
//   node deploy/backend/migrate-env-broker-to-db.js [--user-id N] [--dry-run]
//
// Reads ZERODHA_API_KEY / ZERODHA_API_SECRET (or KITE_*) from env, seals them with the vault,
// and inserts/updates broker_accounts for the specified user (default = first admin, then user_id=1).
//
// Idempotent: re-running just updates existing row in-place. Safe to run multiple times.

'use strict';

const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname);
const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');

function arg(name, def) {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : def;
}
const explicitUserId = arg('--user-id') ? parseInt(arg('--user-id'), 10) : null;

(async () => {
  console.log('=== Tier 57 migration: env broker creds -> DB ===');

  // 1. Load env. Prefer .env file if present, fall back to process.env.
  const envPath = path.join(ROOT, '.env');
  let env = { ...process.env };
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const ln of lines) {
      const m = ln.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.*)$/i);
      if (m) {
        let v = m[2].trim();
        if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
        if (env[m[1]] == null) env[m[1]] = v;
      }
    }
  }

  const apiKey   = env.ZERODHA_API_KEY    || env.KITE_API_KEY;
  const apiSecret= env.ZERODHA_API_SECRET || env.KITE_API_SECRET;
  const redirect = env.ZERODHA_REDIRECT_URL || env.KITE_REDIRECT_URL || '';
  if (!apiKey || !apiSecret) {
    console.error('[migrate] no ZERODHA_API_KEY / ZERODHA_API_SECRET in env or .env -- nothing to do');
    process.exit(2);
  }

  // 2. Load access_token from /var/lib/ats/tokens/zerodha.json (legacy on-disk sessions)
  let accessToken = null;
  const tokensDir = env.TOKENS_DIR || '/var/lib/ats/tokens';
  const tokenFile = path.join(tokensDir, 'zerodha.json');
  if (fs.existsSync(tokenFile)) {
    try {
      const j = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
      accessToken = j.access_token || j.accessToken || null;
      console.log(`[migrate] found legacy access_token in ${tokenFile} (broker_user_id=${j.user_id || j.userId || 'unknown'})`);
    } catch (e) {
      console.warn(`[migrate] could not read ${tokenFile}:`, e.message);
    }
  }

  // 3. Open DB
  const { open } = require('./db');
  const db = open();
  console.log('[migrate] DB opened');

  // 4. Pick target user_id
  let userId = explicitUserId;
  if (!userId) {
    // Promote the first user to admin if none exists yet, then use them
    const count = db.users.count();
    if (count === 0) {
      console.error('[migrate] no users exist in DB. Sign up first via the UI, then re-run with --user-id.');
      process.exit(3);
    }
    db.users.promoteFirstToAdmin();
    // The first row is now admin
    const first = db._conn.prepare('SELECT id, email FROM users WHERE is_admin=1 ORDER BY id ASC LIMIT 1').get();
    if (!first) {
      console.error('[migrate] failed to find admin user. Pass --user-id explicitly.');
      process.exit(4);
    }
    userId = first.id;
    console.log(`[migrate] target user_id=${userId} (${first.email})`);
  } else {
    const u = db.users.byId(userId);
    if (!u) {
      console.error(`[migrate] user_id=${userId} not found`);
      process.exit(5);
    }
    console.log(`[migrate] target user_id=${userId} (${u.email})`);
  }

  // 5. Open vault
  const { Vault } = require('./crypto-vault');
  const masterKeyPath = env.MASTER_KEY_PATH || '/var/lib/ats/master.key';
  if (!fs.existsSync(masterKeyPath)) {
    console.error(`[migrate] master key not found at ${masterKeyPath}. Set MASTER_KEY_PATH or generate one first.`);
    process.exit(6);
  }
  const vault = await Vault.open(masterKeyPath);
  console.log('[migrate] vault opened');

  // 6. Seal + upsert
  const sealedKey    = await vault.seal(apiKey);
  const sealedSecret = await vault.seal(apiSecret);
  const sealedTok    = accessToken ? await vault.seal(accessToken) : null;

  const brokerUserId = (() => {
    try {
      if (fs.existsSync(tokenFile)) {
        const j = JSON.parse(fs.readFileSync(tokenFile, 'utf8'));
        return j.user_id || j.userId || '';
      }
    } catch (_) {}
    return '';
  })();

  if (dryRun) {
    console.log('[migrate] DRY RUN -- would upsert:', {
      user_id: userId, broker: 'zerodha', broker_user_id: brokerUserId,
      api_key: '[sealed]', api_secret: '[sealed]',
      access_token: sealedTok ? '[sealed]' : null, is_default: true,
    });
  } else {
    db.brokers.upsert({
      user_id: userId,
      broker: 'zerodha',
      broker_user_id: brokerUserId || 'ARS209',
      api_key: sealedKey,
      refresh_token: sealedSecret,         // api_secret co-located in refresh_token slot
      access_token: sealedTok,
      issued_at: new Date().toISOString(),
      is_default: true,
    });

    // Mark this row as the user's default
    const row = db.brokers.getByBroker(userId, 'zerodha');
    if (row) db.brokers.setDefault(userId, row.id);

    console.log(`[migrate] OK: broker_accounts row written for user_id=${userId}`);
    console.log(`[migrate] Next step: drop ZERODHA_API_KEY/SECRET from .env once you verify /api/me/broker returns the row.`);
  }
})().catch((err) => {
  console.error('[migrate] fatal:', err && (err.stack || err.message || err));
  process.exit(1);
});

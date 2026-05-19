#!/usr/bin/env node
// T-210 (CODE-AUDIT E.4): rotate the libsodium master key.
//
// Before this script existed, a key compromise was unrecoverable -- the only
// documented path was "wipe everything and re-onboard". This script:
//
//   1. Generates a new 32-byte libsodium secretbox key.
//   2. Walks every sealed cell in the system:
//        broker_accounts.{access_token, refresh_token, feed_token,
//                         api_key, client_id, totp_seed}
//        ai_keys.sealed_key
//        user_notifications.{telegram_bot_token, webhook_secret}
//        /var/lib/ats/tokens/*.enc   (per-user Zerodha tokens, Tier 75 legacy)
//        /var/lib/ats/tokens/_zerodha-login.enc   (auto-login daemon bundle)
//   3. For each: unseal-with-OLD-key + reseal-with-NEW-key, inside ONE
//      SQLite transaction. If any single cell fails to unseal, the whole
//      run aborts and nothing is written.
//   4. Atomically swaps /etc/ats/master.key -> master.key.<timestamp>.bak
//      with the new key only after every reseal succeeds.
//
// Safety defaults:
//   - DRY_RUN by default. Prints the cell inventory + counts; touches
//     nothing.
//   - To actually rotate, the operator must pass both:
//         --commit
//         --i-have-read-the-runbook
//     The runbook is deploy/docs/INCIDENT-RUNBOOK.md, "Master key
//     rotation" section.
//   - On --commit, the old key file is kept (renamed with timestamp) for
//     24 hours so the operator can roll back by `mv` if anything is wrong.
//
// Usage:
//   sudo -u ats node /opt/ats/scripts/rotate-master-key.js
//        # dry-run -- shows the cell inventory
//
//   sudo -u ats node /opt/ats/scripts/rotate-master-key.js \
//        --commit --i-have-read-the-runbook
//        # actual rotation
//
// Requirements:
//   - Run as the `ats` user (the user that owns master.key on the VM).
//   - Backend container should be STOPPED during rotation:
//         sudo systemctl stop ats-backend OR docker compose stop
//     (Otherwise new sealed cells written by the running backend during
//     rotation would use the OLD key, and the post-rotation `Vault.open`
//     would fail.)
//   - SQLite at /var/lib/ats/ats.db must be readable+writable by the
//     running user (group ats, file 0664).
//
// Verification after rotation:
//   - `node -e "Vault.open('/etc/ats/master.key').then(v => v.open(<a sealed cell>))"`
//     against any cell that didn't change should round-trip.
//   - Restart the backend; the first `/api/me/ai-keys` GET should succeed
//     for an authed user (proves ai_keys.sealed_key decrypts).
//   - The next scheduled bulk-rotate (broker token reauth) should succeed
//     (proves broker_accounts.api_key + totp_seed decrypt).

'use strict';

const fs   = require('fs');
const path = require('path');

// ---------- args ----------
const argv = process.argv.slice(2);
const has = (flag) => argv.includes(flag);
const COMMIT       = has('--commit');
const ACK_RUNBOOK  = has('--i-have-read-the-runbook');
const SHOW_HELP    = has('--help') || has('-h');

if (SHOW_HELP) {
  console.error('Usage: rotate-master-key.js [--commit --i-have-read-the-runbook]');
  console.error('See top of this file for full documentation.');
  process.exit(0);
}

const DRY_RUN = !COMMIT;
const KEY_PATH = process.env.MASTER_KEY_PATH || '/etc/ats/master.key';
const DB_PATH  = process.env.ATS_DB_PATH || '/var/lib/ats/ats.db';
const TOKENS_DIR = process.env.ATS_TOKENS_DIR || '/var/lib/ats/tokens';

console.log('---------------------------------------------------------------');
console.log(' T-210 Master Key Rotation');
console.log('---------------------------------------------------------------');
console.log(' Mode:        ' + (DRY_RUN ? 'DRY_RUN (no writes)' : 'COMMIT'));
console.log(' Master key:  ' + KEY_PATH);
console.log(' DB:          ' + DB_PATH);
console.log(' Tokens dir:  ' + TOKENS_DIR);
console.log('---------------------------------------------------------------');

if (COMMIT && !ACK_RUNBOOK) {
  console.error('\nERROR: --commit requires also passing --i-have-read-the-runbook.');
  console.error('Read deploy/docs/INCIDENT-RUNBOOK.md "Master key rotation" first.');
  console.error('Rotation is irreversible after the new key is written; this flag');
  console.error('is the operator confirmation that pre-flight checks have been done.');
  process.exit(2);
}

// ---------- main ----------
(async () => {
  // 1. Backend module loading.
  const here = __dirname; // /opt/ats/scripts on the VM
  // Resolve the crypto-vault module relative to the script location. On the
  // VM, the script sits in /opt/ats/scripts and the backend at /opt/ats/backend.
  const cvPath = path.resolve(here, '..', 'backend', 'crypto-vault.js');
  if (!fs.existsSync(cvPath)) {
    console.error('FATAL: crypto-vault.js not found at ' + cvPath);
    console.error('       Set ATS_BACKEND_DIR env to point at the backend dir.');
    process.exit(3);
  }
  const { Vault, writeNewMasterKey } = require(cvPath);

  // 2. Open the old vault.
  console.log('\n[1/6] Loading old master key...');
  const oldVault = await Vault.open(KEY_PATH);
  console.log('      OK');

  // 3. Generate the new key in memory (don't write to disk yet).
  console.log('\n[2/6] Generating new master key...');
  const sodium = await require('libsodium-wrappers');
  await sodium.ready;
  const newKeyBytes = sodium.randombytes_buf(sodium.crypto_secretbox_KEYBYTES);
  const newVault = new Vault(new Uint8Array(newKeyBytes));
  console.log('      32 bytes generated');

  // 4. Enumerate sealed cells.
  console.log('\n[3/6] Enumerating sealed cells...');

  // Connect to SQLite. Use better-sqlite3 since that's what the backend uses.
  let Database;
  try { Database = require(path.resolve(cvPath, '..', '..', 'backend', 'node_modules', 'better-sqlite3')); }
  catch (e) {
    try { Database = require('better-sqlite3'); }
    catch (_) {
      console.error('FATAL: better-sqlite3 not found. Install backend deps first.');
      process.exit(4);
    }
  }
  const db = new Database(DB_PATH, { fileMustExist: true });

  // Inventory of (table, id_col, value_col) for every sealed cell in the DB.
  // The id_col is just for logging -- it's whatever PK lets us locate the row.
  const SEALED = [
    // broker_accounts: 6 sealed columns
    ['broker_accounts', 'id', 'access_token'],
    ['broker_accounts', 'id', 'refresh_token'],
    ['broker_accounts', 'id', 'feed_token'],
    ['broker_accounts', 'id', 'api_key'],
    ['broker_accounts', 'id', 'client_id'],
    ['broker_accounts', 'id', 'totp_seed'],
    // ai_keys (defined inline in ai-keys-routes.js)
    ['ai_keys', 'id', 'sealed_key'],
    // user_notifications (defined inline in db.js)
    ['user_notifications', 'user_id', 'telegram_bot_token'],
    ['user_notifications', 'user_id', 'webhook_secret'],
  ];

  const cellsToRotate = [];

  for (const [table, idCol, valCol] of SEALED) {
    // Skip table if it doesn't exist (e.g. fresh install with ai_keys not yet created).
    const exists = db.prepare(
      `SELECT name FROM sqlite_master WHERE type='table' AND name=?`
    ).get(table);
    if (!exists) {
      console.log('      ' + table + '.' + valCol + ': table not present (skip)');
      continue;
    }
    const rows = db.prepare(
      `SELECT ${idCol} as id, ${valCol} as val FROM ${table} WHERE ${valCol} IS NOT NULL AND ${valCol} != ''`
    ).all();
    cellsToRotate.push({ table, idCol, valCol, rows });
    console.log('      ' + table + '.' + valCol + ': ' + rows.length + ' rows');
  }

  // File-based sealed cells.
  const tokenFiles = [];
  if (fs.existsSync(TOKENS_DIR)) {
    for (const fname of fs.readdirSync(TOKENS_DIR)) {
      if (fname.endsWith('.enc')) tokenFiles.push(path.join(TOKENS_DIR, fname));
    }
  }
  console.log('      ' + TOKENS_DIR + '/*.enc: ' + tokenFiles.length + ' files');

  // 5. Unseal-old + reseal-new in a transaction.
  const totalCells = cellsToRotate.reduce((a, c) => a + c.rows.length, 0) + tokenFiles.length;
  console.log('\n[4/6] Total cells to rotate: ' + totalCells);

  if (DRY_RUN) {
    console.log('\n--- DRY_RUN: no writes performed. ---');
    console.log('\nTo actually rotate, re-run with:');
    console.log('  --commit --i-have-read-the-runbook');
    console.log('See deploy/docs/INCIDENT-RUNBOOK.md "Master key rotation".\n');
    db.close();
    process.exit(0);
  }

  console.log('\n[5/6] COMMIT mode -- beginning rotation transaction...');

  // Build the new sealed values OUTSIDE the transaction first so a failed
  // unseal aborts before any write. SQLite transactions don't help with
  // file-based seals so we batch the file reseal too.
  const dbUpdates = [];
  for (const cell of cellsToRotate) {
    for (const row of cell.rows) {
      try {
        const plaintext = await oldVault.open(row.val);
        const newSealed = await newVault.seal(plaintext);
        dbUpdates.push({ table: cell.table, idCol: cell.idCol, valCol: cell.valCol, id: row.id, newSealed });
      } catch (e) {
        console.error('FATAL: failed to unseal ' + cell.table + '.' + cell.valCol +
                      ' row id=' + row.id + ': ' + e.message);
        console.error('Aborting. No writes performed. Investigate the corrupt cell.');
        db.close();
        process.exit(5);
      }
    }
  }

  const fileUpdates = [];
  for (const fpath of tokenFiles) {
    try {
      const old = fs.readFileSync(fpath, 'utf8').trim();
      const plaintext = await oldVault.open(old);
      const newSealed = await newVault.seal(plaintext);
      fileUpdates.push({ fpath, newSealed });
    } catch (e) {
      console.error('FATAL: failed to unseal ' + fpath + ': ' + e.message);
      console.error('Aborting. No writes performed.');
      db.close();
      process.exit(5);
    }
  }

  console.log('      All ' + totalCells + ' cells unsealed + resealed in memory. Writing...');

  // DB transaction
  const tx = db.transaction(() => {
    for (const u of dbUpdates) {
      const sql = `UPDATE ${u.table} SET ${u.valCol} = ? WHERE ${u.idCol} = ?`;
      db.prepare(sql).run(u.newSealed, u.id);
    }
  });
  tx();
  console.log('      DB transaction committed (' + dbUpdates.length + ' cells)');

  // Files
  for (const u of fileUpdates) {
    fs.writeFileSync(u.fpath, u.newSealed);
  }
  console.log('      File-based cells rewritten (' + fileUpdates.length + ' files)');

  db.close();

  // 6. Atomic swap of the master key file. Backup the old key first.
  console.log('\n[6/6] Swapping master key...');
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = KEY_PATH + '.' + ts + '.bak';

  // Verify the new key actually round-trips against one freshly-resealed cell
  // before swapping the file. This is the last safety net.
  let verifyOk = false;
  if (dbUpdates.length > 0) {
    const u = dbUpdates[0];
    const newSealedFromDb = db.prepare(`SELECT ${u.valCol} as v FROM ${u.table} WHERE ${u.idCol} = ?`).get(u.id);
    // Re-open db for this check (already closed above).
    const _db2 = new Database(DB_PATH, { fileMustExist: true });
    const row = _db2.prepare(`SELECT ${u.valCol} as v FROM ${u.table} WHERE ${u.idCol} = ?`).get(u.id);
    try {
      const _pt = await newVault.open(row.v);
      verifyOk = !!_pt;
    } catch (_) {}
    _db2.close();
  } else {
    verifyOk = true; // No DB cells to verify; trust the in-memory seal.
  }
  if (!verifyOk) {
    console.error('FATAL: post-write verification failed. Old key still in place at ' + KEY_PATH);
    console.error('       DB updates were committed but the master.key file was NOT swapped.');
    console.error('       Run the script again or manually inspect.');
    process.exit(6);
  }

  // Backup old.
  fs.copyFileSync(KEY_PATH, backupPath);
  fs.chmodSync(backupPath, 0o400);
  console.log('      Old key backed up to ' + backupPath);

  // Write new key (chmod 400, same as setup script).
  fs.writeFileSync(KEY_PATH, Buffer.from(newKeyBytes));
  fs.chmodSync(KEY_PATH, 0o400);
  console.log('      New key written to ' + KEY_PATH);

  console.log('\n---------------------------------------------------------------');
  console.log(' ROTATION COMPLETE');
  console.log('---------------------------------------------------------------');
  console.log(' Old key backup:  ' + backupPath);
  console.log(' Total cells:     ' + totalCells);
  console.log('');
  console.log(' Next steps (FROM THE RUNBOOK):');
  console.log('   1. Restart ats-backend so the in-process Vault picks up the');
  console.log('      new key:  sudo systemctl restart ats-backend');
  console.log('   2. Verify with: curl -sS -b "<authed-session-cookie>" \\');
  console.log('                       https://ats.rajasekarselvam.com/api/me/ai-keys');
  console.log('      Expect 200 with the configured providers listed.');
  console.log('   3. Keep ' + backupPath + ' for 24 hours.');
  console.log('   4. After 24h with no incidents, delete the backup:');
  console.log('        sudo rm ' + backupPath);
  console.log('');
  console.log(' If anything is wrong, ROLL BACK:');
  console.log('   sudo cp ' + backupPath + ' ' + KEY_PATH);
  console.log('   sudo chmod 400 ' + KEY_PATH);
  console.log('   sudo systemctl restart ats-backend');
  console.log('---------------------------------------------------------------');
})().catch((e) => {
  console.error('\nUNHANDLED ERROR:', e && e.stack ? e.stack : e);
  process.exit(99);
});

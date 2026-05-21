#!/usr/bin/env node
// T-314 -- Cleanup test/diagnostic user accounts.
//
// Identifies accounts that match known test-user patterns and prints a
// summary. By default it is DRY-RUN (just prints what it would delete).
// Pass --apply to actually DELETE. ON DELETE CASCADE handles all linked
// rows (broker_accounts, paper_state/orders/positions, autorun_config,
// sip_fires, sips, watchlist, user_risk_config, user_sessions, etc.).
//
// Safe to run multiple times -- idempotent (already-deleted = no-op).
//
// Usage on the VM:
//   sudo docker exec ats-backend node /opt/ats/backend/scripts/cleanup-test-users.js
//   sudo docker exec ats-backend node /opt/ats/backend/scripts/cleanup-test-users.js --apply

'use strict';

const { open } = require('../db');

const PATTERNS = [
  /^diag-/i,
  /@test\.example$/i,
  /@diag\.example$/i,
  /@d\.example$/i,
  /^u\d{10}@test\.example$/i,        // T-228 verification residue
  /^verify-final-\d+@/i,             // T-228 follow-up
  /^smoke-/i,                         // any smoke-test users (incl. id=42 we added)
];
const EXPLICIT_IDS = [10, 13];

function matchesPattern(email) {
  if (!email) return false;
  return PATTERNS.some(rx => rx.test(email));
}

function main() {
  const apply = process.argv.includes('--apply');
  const db = open();
  const conn = db._conn;

  const rows = conn.prepare(`
    SELECT id, email, name, created_at, is_verified, is_active
    FROM users
    ORDER BY id
  `).all();

  const matches = rows.filter(u => EXPLICIT_IDS.includes(u.id) || matchesPattern(u.email));

  console.log(`Total users: ${rows.length}`);
  console.log(`Matched for cleanup: ${matches.length}`);
  if (matches.length === 0) {
    console.log('Nothing to do.');
    process.exit(0);
  }

  console.log('');
  console.log('id   email                                   created            verified active');
  console.log('---  ---------------------------------------  ------------------  -------- ------');
  for (const u of matches) {
    console.log(
      String(u.id).padStart(3) + '  ' +
      (u.email || '').padEnd(40) + ' ' +
      (u.created_at || '').padEnd(20) + ' ' +
      String(!!u.is_verified).padEnd(8) + ' ' +
      String(!!u.is_active)
    );
  }
  console.log('');

  if (!apply) {
    console.log('DRY RUN -- no rows deleted. Re-run with --apply to delete.');
    process.exit(0);
  }

  // Safety: never delete the operator account (id=1 by convention)
  const filtered = matches.filter(u => u.id !== 1);
  if (filtered.length !== matches.length) {
    console.log('Skipping operator id=1 from deletion list (refusing to delete).');
  }

  const del = conn.prepare('DELETE FROM users WHERE id = ?');
  const trx = conn.transaction((items) => {
    let n = 0;
    for (const u of items) {
      const r = del.run(u.id);
      if (r.changes === 1) {
        console.log(`  deleted id=${u.id} email=${u.email}`);
        n++;
      } else {
        console.log(`  skipped id=${u.id} (no rows changed)`);
      }
    }
    return n;
  });

  const deleted = trx(filtered);
  console.log('');
  console.log(`Deleted ${deleted} user(s). Cascading rows in broker_accounts, paper_*, user_risk_config, sip_fires, etc. were removed by ON DELETE CASCADE.`);
}

if (require.main === module) {
  try { main(); }
  catch (e) { console.error('FAILED:', e.message); console.error(e.stack); process.exit(1); }
}

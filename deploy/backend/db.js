// db.js -- Tier 49: SQLite (better-sqlite3) connection + WAL mode + migrations.
//
// Why SQLite + better-sqlite3:
//   - Synchronous prepared-statement API matches Node's existing module pattern
//   - WAL mode: concurrent readers + single writer, no daemon required
//   - Native ARM64 prebuilt for our Oracle Cloud Ampere A1 VM
//   - Single file at /var/lib/ats/ats.db (volume-mounted, easy to back up)
//   - 64MB page cache + memory-mapped IO -> microsecond reads on small tables
//
// Public API:
//   const db = require('./db').open();
//   db.users.create({ email, password_hash, name })
//   db.users.byEmail('x@y.com')
//   db.exec('VACUUM');                   -- escape hatch for ad-hoc SQL
//   db.transaction(() => { ... })        -- atomic batch

'use strict';

const fs = require('fs');
const path = require('path');

let Database;
try { Database = require('better-sqlite3'); }
catch (_) { Database = null; /* sandbox without native build; module loads, open() throws */ }

const DEFAULT_PATH = process.env.ATS_DB_PATH || '/var/lib/ats/ats.db';
const SCHEMA_PATH  = path.join(__dirname, 'schema.sql');

let _instance = null;

function open(opts = {}) {
  if (_instance) return _instance;
  if (!Database) throw new Error('better-sqlite3 not installed -- run `npm install` in deploy/backend');
  const dbPath = opts.path || DEFAULT_PATH;
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const conn = new Database(dbPath, { verbose: opts.verbose || null });

  // Apply schema (idempotent: every CREATE has IF NOT EXISTS)
  const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
  conn.exec(schema);

  // Record schema version 1 if not already
  const v = conn.prepare('SELECT COUNT(*) AS n FROM _schema_version').get().n;
  if (v === 0) conn.prepare('INSERT INTO _schema_version (version) VALUES (1)').run();

  _instance = makeRepo(conn);
  return _instance;
}

function close() {
  if (_instance && _instance._conn) {
    _instance._conn.close();
    _instance = null;
  }
}

function makeRepo(conn) {
  // Prepared statements (compiled once, reused forever)
  const stmts = {
    // users
    userInsert:        conn.prepare('INSERT INTO users (email, password_hash, name, verification_token, verification_sent_at) VALUES (@email, @password_hash, @name, @verification_token, @verification_sent_at)'),
    userByEmail:       conn.prepare('SELECT * FROM users WHERE email = ?'),
    userById:          conn.prepare('SELECT * FROM users WHERE id = ?'),
    userByVerifyToken: conn.prepare('SELECT * FROM users WHERE verification_token = ?'),
    userByResetToken:  conn.prepare('SELECT * FROM users WHERE reset_token = ?'),
    userMarkVerified:  conn.prepare('UPDATE users SET is_verified=1, verification_token=NULL WHERE id = ?'),
    userSetReset:      conn.prepare('UPDATE users SET reset_token=@token, reset_expires_at=@exp WHERE id = @id'),
    userClearReset:    conn.prepare('UPDATE users SET reset_token=NULL, reset_expires_at=NULL, password_hash=@hash WHERE id = @id'),
    userTouchLogin:    conn.prepare('UPDATE users SET last_login_at = datetime(\'now\'), failed_logins=0 WHERE id = ?'),
    userBumpFailed:    conn.prepare('UPDATE users SET failed_logins = failed_logins + 1 WHERE id = ?'),
    userLock:          conn.prepare('UPDATE users SET locked_until = ? WHERE id = ?'),
    userCount:         conn.prepare('SELECT COUNT(*) AS n FROM users'),
    userPromoteFirstToAdmin: conn.prepare('UPDATE users SET is_admin=1, is_verified=1 WHERE id = (SELECT id FROM users ORDER BY id ASC LIMIT 1)'),

    // sessions
    sessionInsert: conn.prepare('INSERT INTO user_sessions (id, user_id, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?)'),
    sessionGet:    conn.prepare('SELECT s.*, u.email, u.name, u.is_admin, u.is_verified FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ? AND s.expires_at > datetime(\'now\')'),
    sessionDelete: conn.prepare('DELETE FROM user_sessions WHERE id = ?'),
    sessionPurge:  conn.prepare('DELETE FROM user_sessions WHERE expires_at <= datetime(\'now\')'),

    // watchlist
    wlAdd:    conn.prepare('INSERT OR IGNORE INTO watchlist (user_id, symbol, exchange) VALUES (?, ?, ?)'),
    wlRemove: conn.prepare('DELETE FROM watchlist WHERE user_id = ? AND symbol = ?'),
    wlList:   conn.prepare('SELECT symbol, exchange, added_at FROM watchlist WHERE user_id = ? ORDER BY added_at DESC'),
  };

  return {
    _conn: conn,
    exec:  (sql) => conn.exec(sql),
    transaction: (fn) => conn.transaction(fn)(),
    pragma: (s) => conn.pragma(s),

    users: {
      create: (u) => stmts.userInsert.run(u),
      byEmail: (e) => stmts.userByEmail.get(e),
      byId:    (id) => stmts.userById.get(id),
      byVerifyToken: (t) => stmts.userByVerifyToken.get(t),
      byResetToken:  (t) => stmts.userByResetToken.get(t),
      markVerified: (id) => stmts.userMarkVerified.run(id),
      setReset: (id, token, exp) => stmts.userSetReset.run({ id, token, exp }),
      clearReset: (id, hash) => stmts.userClearReset.run({ id, hash }),
      touchLogin: (id) => stmts.userTouchLogin.run(id),
      bumpFailed: (id) => stmts.userBumpFailed.run(id),
      lock: (id, until) => stmts.userLock.run(until, id),
      count: () => stmts.userCount.get().n,
      promoteFirstToAdmin: () => stmts.userPromoteFirstToAdmin.run(),
    },
    sessions: {
      create: (id, userId, expiresAt, ip, ua) => stmts.sessionInsert.run(id, userId, expiresAt, ip, ua),
      get:    (id) => stmts.sessionGet.get(id),
      delete: (id) => stmts.sessionDelete.run(id),
      purgeExpired: () => stmts.sessionPurge.run().changes,
    },
    watchlist: {
      add: (userId, symbol, exchange) => stmts.wlAdd.run(userId, symbol, exchange || 'NSE'),
      remove: (userId, symbol) => stmts.wlRemove.run(userId, symbol),
      list: (userId) => stmts.wlList.all(userId),
    },
  };
}

module.exports = { open, close, DEFAULT_PATH };

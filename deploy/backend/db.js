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

const DEFAULT_PATH = process.env.ATS_DB_PATH || '/var/lib/ats/tokens/ats.db';
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

  // Tier 53: extra repos (alerts, paper, autorun, pnl)
  const x = {
    alertInsert: conn.prepare('INSERT INTO price_alerts (user_id, symbol, operator, trigger_price, channel) VALUES (?, ?, ?, ?, ?)'),
    alertList:   conn.prepare('SELECT * FROM price_alerts WHERE user_id = ? AND active = 1 ORDER BY created_at DESC'),
    alertDelete: conn.prepare('DELETE FROM price_alerts WHERE id = ? AND user_id = ?'),
    alertFire:   conn.prepare('UPDATE price_alerts SET fired_at = datetime(\'now\'), active = 0 WHERE id = ?'),

    paperGetState: conn.prepare('SELECT * FROM paper_state WHERE user_id = ?'),
    paperUpsertState: conn.prepare('INSERT INTO paper_state (user_id, tier, cash, initial_capital, realized_pnl) VALUES (@user_id, @tier, @cash, @initial_capital, @realized_pnl) ON CONFLICT(user_id) DO UPDATE SET tier=@tier, cash=@cash, initial_capital=@initial_capital, realized_pnl=@realized_pnl, updated_at=datetime(\'now\')'),
    paperPlaceOrder: conn.prepare('INSERT INTO paper_orders (user_id, client_order_id, strategy_tag, symbol, side, qty, order_type, product, req_price, fill_price, slippage, status, filled_at) VALUES (@user_id, @client_order_id, @strategy_tag, @symbol, @side, @qty, @order_type, @product, @req_price, @fill_price, @slippage, @status, @filled_at)'),
    paperListOrders: conn.prepare('SELECT * FROM paper_orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 200'),
    paperListPositions: conn.prepare('SELECT * FROM paper_positions WHERE user_id = ?'),

    autorunGet:    conn.prepare('SELECT * FROM autorun_config WHERE user_id = ?'),
    autorunUpsert: conn.prepare('INSERT INTO autorun_config (user_id, enabled, strategy, symbol, qty, interval, interval_minutes, candle_lookback_days) VALUES (@user_id, @enabled, @strategy, @symbol, @qty, @interval, @interval_minutes, @candle_lookback_days) ON CONFLICT(user_id) DO UPDATE SET enabled=@enabled, strategy=@strategy, symbol=@symbol, qty=@qty, interval=@interval, interval_minutes=@interval_minutes, candle_lookback_days=@candle_lookback_days, updated_at=datetime(\'now\')'),
    autorunDelete: conn.prepare('DELETE FROM autorun_config WHERE user_id = ?'),
    autorunHistAdd: conn.prepare('INSERT INTO autorun_history (user_id, strategy, symbol, signal, action, note) VALUES (?, ?, ?, ?, ?, ?)'),
    autorunHistList: conn.prepare('SELECT * FROM autorun_history WHERE user_id = ? ORDER BY ts DESC LIMIT 100'),

    pnlUpsertDay: conn.prepare('INSERT INTO pnl_daily (user_id, date, realized_pnl, unrealized_pnl, equity, trades) VALUES (@user_id, @date, @realized_pnl, @unrealized_pnl, @equity, @trades) ON CONFLICT(user_id, date) DO UPDATE SET realized_pnl=@realized_pnl, unrealized_pnl=@unrealized_pnl, equity=@equity, trades=@trades'),
    pnlRecent:    conn.prepare('SELECT * FROM pnl_daily WHERE user_id = ? ORDER BY date DESC LIMIT ?'),

    // Tier 57: broker_accounts CRUD
    brokerListByUser: conn.prepare('SELECT id, user_id, broker, broker_user_id, issued_at, expires_at, is_default, created_at, (api_key IS NOT NULL) AS has_api_key, (access_token IS NOT NULL) AS has_access_token, (totp_seed IS NOT NULL) AS has_totp FROM broker_accounts WHERE user_id = ? ORDER BY is_default DESC, created_at DESC'),
    brokerGetFull:    conn.prepare('SELECT * FROM broker_accounts WHERE id = ? AND user_id = ?'),
    brokerGetByBrokerForUser: conn.prepare('SELECT * FROM broker_accounts WHERE user_id = ? AND broker = ? ORDER BY is_default DESC, created_at DESC LIMIT 1'),
    brokerUpsert:     conn.prepare(`
      INSERT INTO broker_accounts (user_id, broker, broker_user_id, access_token, refresh_token, feed_token, api_key, client_id, totp_seed, issued_at, expires_at, is_default)
      VALUES (@user_id, @broker, @broker_user_id, @access_token, @refresh_token, @feed_token, @api_key, @client_id, @totp_seed, @issued_at, @expires_at, @is_default)
      ON CONFLICT(user_id, broker, broker_user_id) DO UPDATE SET
        access_token = COALESCE(@access_token, access_token),
        refresh_token = COALESCE(@refresh_token, refresh_token),
        feed_token = COALESCE(@feed_token, feed_token),
        api_key = COALESCE(@api_key, api_key),
        client_id = COALESCE(@client_id, client_id),
        totp_seed = COALESCE(@totp_seed, totp_seed),
        issued_at = COALESCE(@issued_at, issued_at),
        expires_at = COALESCE(@expires_at, expires_at),
        is_default = @is_default
    `),
    brokerUpdateTokens: conn.prepare(`UPDATE broker_accounts SET access_token=@access_token, issued_at=@issued_at, expires_at=@expires_at WHERE id=@id AND user_id=@user_id`),
    brokerDelete:     conn.prepare('DELETE FROM broker_accounts WHERE id = ? AND user_id = ?'),
    brokerClearDefault: conn.prepare('UPDATE broker_accounts SET is_default = 0 WHERE user_id = ?'),
    brokerSetDefault:   conn.prepare('UPDATE broker_accounts SET is_default = 1 WHERE id = ? AND user_id = ?'),
  };

  return {
    _conn: conn,
    exec:  (sql) => conn.exec(sql),
    transaction: (fn) => conn.transaction(fn)(),
    pragma: (s) => conn.pragma(s),
    alerts: {
      add: (uid, symbol, operator, price, channel) => x.alertInsert.run(uid, symbol, operator, price, channel || 'telegram'),
      list: (uid) => x.alertList.all(uid),
      remove: (uid, id) => x.alertDelete.run(id, uid),
      markFired: (id) => x.alertFire.run(id),
    },
    paper: {
      getState: (uid) => x.paperGetState.get(uid) || { user_id: uid, tier: '10L', cash: 1000000, initial_capital: 1000000, realized_pnl: 0 },
      setState: (s) => x.paperUpsertState.run(s),
      placeOrder: (o) => x.paperPlaceOrder.run(o),
      listOrders: (uid) => x.paperListOrders.all(uid),
      listPositions: (uid) => x.paperListPositions.all(uid),
    },
    autorun: {
      get: (uid) => x.autorunGet.get(uid),
      upsert: (c) => x.autorunUpsert.run(c),
      delete: (uid) => x.autorunDelete.run(uid),
      addHistory: (uid, strategy, symbol, signal, action, note) => x.autorunHistAdd.run(uid, strategy, symbol, signal, action, note),
      listHistory: (uid) => x.autorunHistList.all(uid),
    },
    pnl: {
      upsertDay: (row) => x.pnlUpsertDay.run(row),
      recent: (uid, n) => x.pnlRecent.all(uid, Math.min(365, Math.max(1, n || 7))),
    },

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
    brokers: {
      /** List all broker_accounts for a user. Secret fields stripped (only presence flags). */
      list: (userId) => x.brokerListByUser.all(userId),
      /** Get a single broker row (includes encrypted secrets — use only inside server). */
      getFull: (userId, id) => x.brokerGetFull.get(id, userId),
      /** Find a user's account for a given broker (e.g. 'zerodha'). */
      getByBroker: (userId, broker) => x.brokerGetByBrokerForUser.get(userId, broker),
      /** Insert-or-merge a broker_account row. Partial fields (e.g. token-only refresh) are merged. */
      upsert: (row) => x.brokerUpsert.run({
        user_id: row.user_id,
        broker: row.broker,
        broker_user_id: row.broker_user_id || '',
        access_token: row.access_token || null,
        refresh_token: row.refresh_token || null,
        feed_token: row.feed_token || null,
        api_key: row.api_key || null,
        client_id: row.client_id || null,
        totp_seed: row.totp_seed || null,
        issued_at: row.issued_at || null,
        expires_at: row.expires_at || null,
        is_default: row.is_default ? 1 : 0,
      }),
      /** Refresh just the daily access_token (after Kite re-auth). */
      updateTokens: (id, userId, accessToken, issuedAt, expiresAt) =>
        x.brokerUpdateTokens.run({ id, user_id: userId, access_token: accessToken, issued_at: issuedAt, expires_at: expiresAt }),
      delete: (userId, id) => x.brokerDelete.run(id, userId),
      setDefault: (userId, id) => {
        x.brokerClearDefault.run(userId);
        return x.brokerSetDefault.run(id, userId);
      },
    },
  };
}

module.exports = { open, close, DEFAULT_PATH };

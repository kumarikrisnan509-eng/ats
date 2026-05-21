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

  // Tier 79: add per-test bookkeeping columns to broker_accounts (idempotent, ignored if exist)
  const _tier79Cols = [
    "ALTER TABLE broker_accounts ADD COLUMN last_test_at TEXT",
    "ALTER TABLE broker_accounts ADD COLUMN last_test_ok INTEGER",
    "ALTER TABLE broker_accounts ADD COLUMN last_test_error TEXT",
  ];
  for (const sql of _tier79Cols) {
    try { conn.exec(sql); } catch (e) { /* duplicate column = already migrated */ }
  }

  // Tier 80: daily auto-reauth cron — add opt-out flag + history table
  try { conn.exec("ALTER TABLE broker_accounts ADD COLUMN auto_reauth_enabled INTEGER DEFAULT 1"); }
  catch (e) { /* already migrated */ }
  conn.exec(`
    CREATE TABLE IF NOT EXISTS cron_reauth_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          TEXT NOT NULL DEFAULT (datetime('now')),
      user_id     INTEGER NOT NULL,
      broker      TEXT NOT NULL,
      ok          INTEGER NOT NULL,
      reason      TEXT,
      elapsed_ms  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_cron_reauth_user_ts ON cron_reauth_history(user_id, ts DESC);
  `);
  // Auto-trim cron_reauth_history to last 500 entries (cheap, runs on insert).
  conn.exec("CREATE TRIGGER IF NOT EXISTS trim_cron_reauth_history AFTER INSERT ON cron_reauth_history BEGIN DELETE FROM cron_reauth_history WHERE id < (SELECT MAX(id)-500 FROM cron_reauth_history); END;");

  // T99-T46: autorun_history is written every autorun fire (per-user). An
  // active strategy running every minute during market hours = ~390 rows/day
  // per user = 142k/year. Trim per-user to the latest 5000 rows (matches the
  // ai_calls cap below). Same idempotent IF NOT EXISTS pattern so existing
  // DBs pick it up on next startup without migration.
  conn.exec(`CREATE TRIGGER IF NOT EXISTS trim_autorun_history AFTER INSERT ON autorun_history BEGIN DELETE FROM autorun_history WHERE id IN (SELECT id FROM autorun_history WHERE user_id = NEW.user_id ORDER BY id DESC LIMIT -1 OFFSET 5000); END;`);

  // Tier 84: per-user display preferences (theme, density, currency, etc.)
  conn.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id            INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      theme              TEXT DEFAULT 'auto',     -- 'light' | 'dark' | 'auto'
      density            TEXT DEFAULT 'comfortable', -- 'comfortable' | 'compact'
      currency_format    TEXT DEFAULT 'abbrev',   -- 'abbrev' (₹4.8L) | 'full' (₹4,82,340)
      round_rupees       INTEGER DEFAULT 0,
      show_pnl_in_header INTEGER DEFAULT 1,
      updated_at         TEXT DEFAULT (datetime('now'))
    );
  `);

  // Tier 84: per-user notification settings (sealed tokens)
  conn.exec(`
    CREATE TABLE IF NOT EXISTS user_notifications (
      user_id              INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      email_enabled        INTEGER DEFAULT 1,
      email_digest_time    TEXT DEFAULT '16:00',
      telegram_enabled     INTEGER DEFAULT 0,
      telegram_bot_token   TEXT,          -- sealed
      telegram_chat_id     TEXT,
      webhook_enabled      INTEGER DEFAULT 0,
      webhook_url          TEXT,
      webhook_secret       TEXT,          -- sealed
      updated_at           TEXT DEFAULT (datetime('now'))
    );
  `);

  // T99-A3: AI call audit log -- one row per LLM invocation. Drives /usage + cap.
  conn.exec(`
    CREATE TABLE IF NOT EXISTS ai_calls (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      ts                TEXT NOT NULL DEFAULT (datetime('now')),
      workflow          TEXT,
      provider          TEXT NOT NULL,
      model             TEXT,
      prompt_tokens     INTEGER DEFAULT 0,
      completion_tokens INTEGER DEFAULT 0,
      cost_inr          REAL NOT NULL DEFAULT 0,
      status            TEXT NOT NULL DEFAULT 'ok',
      error             TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_aicalls_user_ts ON ai_calls(user_id, ts DESC);
  `);
  conn.exec(`CREATE TRIGGER IF NOT EXISTS trim_ai_calls AFTER INSERT ON ai_calls BEGIN DELETE FROM ai_calls WHERE id IN (SELECT id FROM ai_calls WHERE user_id = NEW.user_id ORDER BY id DESC LIMIT -1 OFFSET 5000); END;`);
  // T-I5: add user_feedback column (thumbs up/down per call)
  try { conn.exec("ALTER TABLE ai_calls ADD COLUMN user_feedback TEXT"); }
  catch (e) { /* already migrated */ }
  try { conn.exec("ALTER TABLE ai_calls ADD COLUMN feedback_ts TEXT"); }
  catch (e) { /* already migrated */ }
  // H4: context tag (typically the symbol or strategy this call was about)
  try { conn.exec("ALTER TABLE ai_calls ADD COLUMN context_tag TEXT"); }
  catch (e) { /* already migrated */ }
  // H4: verdict captured from the LLM response so backtest can join verdict -> outcome
  try { conn.exec("ALTER TABLE ai_calls ADD COLUMN verdict TEXT"); }
  catch (e) { /* already migrated */ }
  // H8: A/B experiment + variant on each AI call
  try { conn.exec("ALTER TABLE ai_calls ADD COLUMN experiment_id INTEGER"); }
  catch (e) { /* already migrated */ }
  try { conn.exec("ALTER TABLE ai_calls ADD COLUMN variant TEXT"); }
  catch (e) { /* already migrated */ }
  // H8: experiment registry
  conn.exec(`CREATE TABLE IF NOT EXISTS ai_experiments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    variant_a_key TEXT NOT NULL,
    variant_b_key TEXT NOT NULL,
    workflow TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    ended_at TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_ai_experiments_user_active ON ai_experiments(user_id, active);`);


  // T99-C1: daily AI spend cap (INR/day). Default 50; clamped 0-5000 in prefs.upsert.
  try { conn.exec("ALTER TABLE user_preferences ADD COLUMN daily_ai_cap_inr REAL DEFAULT 50"); }
  catch (e) { /* already migrated */ }
  // T99-H9: AI quality/economy mode (auto-router uses this when caller doesn't override)
  try { conn.exec("ALTER TABLE user_preferences ADD COLUMN ai_mode TEXT DEFAULT 'balanced'"); }
  catch (e) { /* already migrated */ }
  // H5: redact PII (rupee amounts + holdings counts) from prompts (default on)
  try { conn.exec("ALTER TABLE user_preferences ADD COLUMN redact_pii INTEGER DEFAULT 1"); }
  catch (e) { /* already migrated */ }

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

    // T99-A3 / C1: ai_calls audit log + spend rollups + daily-cap getter
    aiCallInsert: conn.prepare("INSERT INTO ai_calls (user_id, workflow, provider, model, prompt_tokens, completion_tokens, cost_inr, status, error, context_tag, verdict) VALUES (@user_id, @workflow, @provider, @model, @prompt_tokens, @completion_tokens, @cost_inr, @status, @error, @context_tag, @verdict)"),
    aiCallsDailySpend: conn.prepare("SELECT COALESCE(SUM(cost_inr), 0) AS spent FROM ai_calls WHERE user_id = ? AND status = 'ok' AND date(ts) = date('now')"),
    aiCallsByPeriod: conn.prepare("SELECT provider, COUNT(*) AS calls, COALESCE(SUM(cost_inr),0) AS cost, COALESCE(SUM(prompt_tokens),0) AS prompt_tokens, COALESCE(SUM(completion_tokens),0) AS completion_tokens FROM ai_calls WHERE user_id = ? AND ts > datetime('now', ?) AND status = 'ok' GROUP BY provider"),
    aiDailyCap: conn.prepare("SELECT COALESCE(daily_ai_cap_inr, 50) AS cap FROM user_preferences WHERE user_id = ?"),
    aiSetFeedback: conn.prepare("UPDATE ai_calls SET user_feedback = @feedback, feedback_ts = datetime('now') WHERE id = @id AND user_id = @user_id"),
    aiGetCall: conn.prepare("SELECT id, ts, workflow, provider, model, cost_inr, status, user_feedback, feedback_ts FROM ai_calls WHERE id = ? AND user_id = ?"),
    aiRecentDown: conn.prepare("SELECT id, ts, workflow, provider, model, cost_inr, user_feedback, feedback_ts FROM ai_calls WHERE user_id = ? AND user_feedback = 'down' ORDER BY feedback_ts DESC LIMIT ?"),
    aiFeedbackCounts: conn.prepare("SELECT user_feedback AS verdict, COUNT(*) AS n FROM ai_calls WHERE user_id = ? AND user_feedback IS NOT NULL AND ts > datetime('now', ?) GROUP BY user_feedback"),
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
    brokerListByUser: conn.prepare('SELECT id, user_id, broker, broker_user_id, issued_at, expires_at, is_default, created_at, last_test_at, last_test_ok, last_test_error, COALESCE(auto_reauth_enabled, 1) AS auto_reauth_enabled, (api_key IS NOT NULL) AS has_api_key, (access_token IS NOT NULL) AS has_access_token, (totp_seed IS NOT NULL) AS has_totp, (feed_token IS NOT NULL) AS has_password FROM broker_accounts WHERE user_id = ? ORDER BY is_default DESC, created_at DESC'),
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
    brokerRecordTest:   conn.prepare("UPDATE broker_accounts SET last_test_at = datetime('now'), last_test_ok = ?, last_test_error = ? WHERE id = ? AND user_id = ?"),
    brokerSetAutoReauth: conn.prepare("UPDATE broker_accounts SET auto_reauth_enabled = ? WHERE id = ? AND user_id = ?"),
    brokerListEligible: conn.prepare("SELECT id, user_id, broker, broker_user_id, api_key, refresh_token, totp_seed, feed_token, access_token, issued_at, expires_at FROM broker_accounts WHERE COALESCE(auto_reauth_enabled, 1) = 1 AND totp_seed IS NOT NULL AND feed_token IS NOT NULL AND api_key IS NOT NULL AND refresh_token IS NOT NULL"),
    cronHistInsert: conn.prepare("INSERT INTO cron_reauth_history (user_id, broker, ok, reason, elapsed_ms) VALUES (?, ?, ?, ?, ?)"),
    cronHistByUser: conn.prepare("SELECT ts, ok, reason, elapsed_ms FROM cron_reauth_history WHERE user_id = ? ORDER BY id DESC LIMIT ?"),

    // Tier 84: preferences
    prefsGet: conn.prepare('SELECT * FROM user_preferences WHERE user_id = ?'),
    prefsUpsert: conn.prepare(`INSERT INTO user_preferences (user_id, theme, density, currency_format, round_rupees, show_pnl_in_header, daily_ai_cap_inr, ai_mode, redact_pii, updated_at)
      VALUES (@user_id, @theme, @density, @currency_format, @round_rupees, @show_pnl_in_header, @daily_ai_cap_inr, @ai_mode, @redact_pii, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET theme=@theme, density=@density, currency_format=@currency_format, round_rupees=@round_rupees, show_pnl_in_header=@show_pnl_in_header, daily_ai_cap_inr=@daily_ai_cap_inr, ai_mode=@ai_mode, redact_pii=@redact_pii, updated_at=datetime('now')`),
    // Tier 84: notifications
    notifGet: conn.prepare('SELECT * FROM user_notifications WHERE user_id = ?'),
    notifUpsert: conn.prepare(`INSERT INTO user_notifications (user_id, email_enabled, email_digest_time, telegram_enabled, telegram_bot_token, telegram_chat_id, webhook_enabled, webhook_url, webhook_secret, updated_at)
      VALUES (@user_id, @email_enabled, @email_digest_time, @telegram_enabled, @telegram_bot_token, @telegram_chat_id, @webhook_enabled, @webhook_url, @webhook_secret, datetime('now'))
      ON CONFLICT(user_id) DO UPDATE SET email_enabled=@email_enabled, email_digest_time=@email_digest_time, telegram_enabled=@telegram_enabled, telegram_bot_token=COALESCE(@telegram_bot_token, telegram_bot_token), telegram_chat_id=@telegram_chat_id, webhook_enabled=@webhook_enabled, webhook_url=@webhook_url, webhook_secret=COALESCE(@webhook_secret, webhook_secret), updated_at=datetime('now')`),
    // Tier 84: account
    userUpdateName: conn.prepare('UPDATE users SET name = ? WHERE id = ?'),
    userUpdateEmail: conn.prepare('UPDATE users SET email = ?, is_verified = 0 WHERE id = ?'),
    userDelete: conn.prepare('DELETE FROM users WHERE id = ?'),
  };

  return {
    _conn: conn,
    // T-298b: expose raw prepare() so services that build their own statements
    // (option-chain-fetcher, options-scanner, future services) don't have to
    // reach into _conn. Pre-T-298b every fresh DB crashed with
    // `db.prepare is not a function` on optionChainFetcher init.
    prepare: (sql) => conn.prepare(sql),
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

    // T99-A3 / C1: AI call log + daily-cap helpers
    ai: {
      logCall: (row) => {
        // Direct stmt instead of prepared (need to include experiment_id + variant columns)
        const result = conn.prepare(`INSERT INTO ai_calls (user_id, workflow, provider, model, prompt_tokens, completion_tokens, cost_inr, status, error, context_tag, verdict, experiment_id, variant) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          row.user_id,
          row.workflow || null,
          row.provider,
          row.model || null,
          row.prompt_tokens || 0,
          row.completion_tokens || 0,
          row.cost_inr || 0,
          row.status || 'ok',
          row.error || null,
          row.context_tag || null,
          row.verdict || null,
          row.experiment_id || null,
          row.variant || null,
        );
        return result.lastInsertRowid;
      },
      dailySpend: (uid) => Number(stmts.aiCallsDailySpend.get(uid).spent || 0),
      // window: '-1 day' | '-7 days' | '-30 days'
      byPeriod: (uid, window) => stmts.aiCallsByPeriod.all(uid, window),
      dailyCapInr: (uid) => {
        const row = stmts.aiDailyCap.get(uid);
        return row ? Number(row.cap || 50) : 50;
      },
      // T99-H9: user's preferred AI mode (quality | balanced | economy)
      userMode: (uid) => {
        try {
          const row = x.prefsGet.get(uid);
          const m = row && row.ai_mode;
          return ['quality','balanced','economy'].includes(m) ? m : 'balanced';
        } catch (_) { return 'balanced'; }
      },
      // T99-F3: cost breakdown by workflow within a time window
      byWorkflow: (uid, window) => {
        const stmt = conn.prepare("SELECT workflow, provider, COUNT(*) AS calls, COALESCE(SUM(cost_inr),0) AS cost FROM ai_calls WHERE user_id = ? AND ts > datetime('now', ?) AND status = 'ok' GROUP BY workflow, provider ORDER BY cost DESC");
        return stmt.all(uid, window);
      },
      // T-I5: feedback helpers
      setFeedback: (uid, callId, feedback) => stmts.aiSetFeedback.run({
        user_id: uid, id: callId,
        feedback: ['up','down',null].includes(feedback) ? feedback : null,
      }),
      getCall: (uid, callId) => stmts.aiGetCall.get(callId, uid),
      recentDown: (uid, limit) => stmts.aiRecentDown.all(uid, Math.min(50, Math.max(1, limit || 10))),
      feedbackCounts: (uid, window) => stmts.aiFeedbackCounts.all(uid, window || '-30 days'),
      // H8: experiment registry helpers
      experimentCreate: (uid, name, workflow, varA, varB) => conn.prepare("INSERT INTO ai_experiments (user_id, name, workflow, variant_a_key, variant_b_key) VALUES (?, ?, ?, ?, ?)").run(uid, name, workflow, varA, varB).lastInsertRowid,
      experimentEnd: (uid, id) => conn.prepare("UPDATE ai_experiments SET active = 0, ended_at = datetime('now') WHERE id = ? AND user_id = ?").run(id, uid),
      experimentListActive: (uid) => conn.prepare("SELECT * FROM ai_experiments WHERE user_id = ? AND active = 1 ORDER BY created_at DESC").all(uid),
      experimentActiveForWorkflow: (uid, workflow) => conn.prepare("SELECT * FROM ai_experiments WHERE user_id = ? AND workflow = ? AND active = 1 ORDER BY created_at DESC LIMIT 1").get(uid, workflow),
      experimentGet: (uid, id) => conn.prepare("SELECT * FROM ai_experiments WHERE id = ? AND user_id = ?").get(id, uid),
      experimentList: (uid) => conn.prepare("SELECT * FROM ai_experiments WHERE user_id = ? ORDER BY created_at DESC LIMIT 50").all(uid),
      experimentResults: (uid, id, days) => {
        const dayWindow = `-${Math.max(1, Math.min(365, days || 30))} days`;
        return conn.prepare(`
          SELECT ai.variant AS variant, ai.context_tag AS symbol, ai.verdict AS verdict,
                 ai.ts AS ai_ts, pt.pnl AS trade_pnl
          FROM ai_calls ai
          LEFT JOIN paper_closed_trades pt
            ON pt.user_id = ai.user_id
           AND UPPER(pt.symbol) = UPPER(ai.context_tag)
           AND pt.entered_at >= ai.ts
           AND julianday(pt.entered_at) - julianday(ai.ts) <= 30
          WHERE ai.user_id = ?
            AND ai.experiment_id = ?
            AND ai.status = 'ok'
            AND ai.ts > datetime('now', ?)
          ORDER BY ai.ts DESC
        `).all(uid, id, dayWindow);
      },

      // H4: join AI critique calls (with context_tag=symbol + verdict) to subsequent paper trades
      verdictBacktest: (uid, days) => {
        const dayWindow = `-${Math.max(1, Math.min(365, days || 30))} days`;
        const stmt = conn.prepare(`
          SELECT
            ai.verdict AS verdict,
            ai.context_tag AS symbol,
            ai.ts AS ai_ts,
            pt.pnl AS trade_pnl,
            pt.exited_at AS trade_ts
          FROM ai_calls ai
          LEFT JOIN paper_closed_trades pt
            ON pt.user_id = ai.user_id
           AND UPPER(pt.symbol) = UPPER(ai.context_tag)
           AND pt.entered_at >= ai.ts
           AND julianday(pt.entered_at) - julianday(ai.ts) <= 30
          WHERE ai.user_id = ?
            AND ai.workflow IN ('intraday_critic','signal_critique','analyze')
            AND ai.status = 'ok'
            AND ai.verdict IS NOT NULL
            AND ai.context_tag IS NOT NULL
            AND ai.ts > datetime('now', ?)
          ORDER BY ai.ts DESC
        `);
        return stmt.all(uid, dayWindow);
      },
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
      // Tier 84
      updateName: (id, name) => x.userUpdateName.run(name, id),
      updateEmail: (id, email) => x.userUpdateEmail.run(email, id),
      delete: (id) => x.userDelete.run(id),
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
      /** Tier 79: record test outcome (called by /broker-test and /broker-auto-reauth). */
      recordTest: (userId, id, ok, errMsg) =>
        x.brokerRecordTest.run(ok ? 1 : 0, errMsg ? String(errMsg).slice(0, 300) : null, id, userId),
      /** Tier 80: toggle daily auto-reauth on/off for this broker row. */
      setAutoReauth: (userId, id, enabled) => x.brokerSetAutoReauth.run(enabled ? 1 : 0, id, userId),
      /** Tier 80: rows eligible for the daily cron (has all 4 sealed credentials + opt-in). */
      listEligible: () => x.brokerListEligible.all(),
    },
    cron: {
      addHistory: (userId, broker, ok, reason, elapsedMs) =>
        x.cronHistInsert.run(userId, broker, ok ? 1 : 0, reason ? String(reason).slice(0, 200) : null, elapsedMs || null),
      recentByUser: (userId, limit) => x.cronHistByUser.all(userId, Math.min(50, Math.max(1, limit || 5))),
    },
    // Tier 84: per-user preferences
    prefs: {
      get: (userId) => {
        const row = x.prefsGet.get(userId);
        const base = { user_id: userId, theme: 'auto', density: 'comfortable', currency_format: 'abbrev', round_rupees: 0, show_pnl_in_header: 1, daily_ai_cap_inr: 50, ai_mode: 'balanced', redact_pii: 1 };
        if (!row) return base;
        return {
          ...base, ...row,
          daily_ai_cap_inr: row.daily_ai_cap_inr == null ? 50 : Number(row.daily_ai_cap_inr),
          ai_mode: ['quality','balanced','economy'].includes(row.ai_mode) ? row.ai_mode : 'balanced',
          redact_pii: row.redact_pii == null ? 1 : (row.redact_pii ? 1 : 0),
        };
      },
      upsert: (row) => {
        // T99-C1: clamp cap to [0, 5000] to avoid fat-finger ₹50,000 entries
        let cap = Number(row.daily_ai_cap_inr);
        if (!Number.isFinite(cap)) cap = 50;
        cap = Math.max(0, Math.min(5000, cap));
        const ai_mode = ['quality','balanced','economy'].includes(row.ai_mode) ? row.ai_mode : 'balanced';
        return x.prefsUpsert.run({
          user_id: row.user_id,
          theme: ['light','dark','auto'].includes(row.theme) ? row.theme : 'auto',
          density: ['comfortable','compact'].includes(row.density) ? row.density : 'comfortable',
          currency_format: ['abbrev','full'].includes(row.currency_format) ? row.currency_format : 'abbrev',
          round_rupees: row.round_rupees ? 1 : 0,
          show_pnl_in_header: row.show_pnl_in_header == null ? 1 : (row.show_pnl_in_header ? 1 : 0),
          daily_ai_cap_inr: cap,
          ai_mode,
        });
      },
    },
    // Tier 84: per-user notification settings
    notif: {
      get: (userId) => x.notifGet.get(userId) || { user_id: userId, email_enabled: 1, email_digest_time: '16:00', telegram_enabled: 0, telegram_bot_token: null, telegram_chat_id: null, webhook_enabled: 0, webhook_url: null, webhook_secret: null },
      upsert: (row) => x.notifUpsert.run({
        user_id: row.user_id,
        email_enabled: row.email_enabled ? 1 : 0,
        email_digest_time: row.email_digest_time || '16:00',
        telegram_enabled: row.telegram_enabled ? 1 : 0,
        telegram_bot_token: row.telegram_bot_token || null,
        telegram_chat_id: row.telegram_chat_id || null,
        webhook_enabled: row.webhook_enabled ? 1 : 0,
        webhook_url: row.webhook_url || null,
        webhook_secret: row.webhook_secret || null,
      }),
    },
  };
}

module.exports = { open, close, DEFAULT_PATH };

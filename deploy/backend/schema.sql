-- ATS SaaS schema. SQLite (better-sqlite3) with WAL mode.
-- All tables carry user_id where applicable for multi-tenancy.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;
PRAGMA synchronous  = NORMAL;
PRAGMA temp_store   = MEMORY;
PRAGMA cache_size   = -64000;     -- 64MB page cache

-- ---------- Schema version tracking ----------
CREATE TABLE IF NOT EXISTS _schema_version (
  version  INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Users + auth ----------
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
  password_hash   TEXT NOT NULL,
  name            TEXT,
  is_verified     INTEGER NOT NULL DEFAULT 0,
  is_admin        INTEGER NOT NULL DEFAULT 0,
  is_active       INTEGER NOT NULL DEFAULT 1,
  verification_token TEXT,
  verification_sent_at TEXT,
  reset_token     TEXT,
  reset_expires_at TEXT,
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  last_login_at   TEXT,
  failed_logins   INTEGER NOT NULL DEFAULT 0,
  locked_until    TEXT
);
CREATE INDEX IF NOT EXISTS idx_users_verification ON users(verification_token);
CREATE INDEX IF NOT EXISTS idx_users_reset        ON users(reset_token);

CREATE TABLE IF NOT EXISTS user_sessions (
  id          TEXT PRIMARY KEY,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (datetime('now')),
  expires_at  TEXT NOT NULL,
  ip          TEXT,
  user_agent  TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON user_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp  ON user_sessions(expires_at);

-- ---------- Broker accounts (per-user OAuth tokens) ----------
CREATE TABLE IF NOT EXISTS broker_accounts (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  broker        TEXT NOT NULL,             -- 'zerodha' | 'dhan' | 'angelone'
  broker_user_id TEXT NOT NULL,            -- broker's UID (e.g. Kite client id)
  access_token  TEXT,                       -- libsodium-sealed
  refresh_token TEXT,                       -- libsodium-sealed (where applicable)
  feed_token    TEXT,                       -- libsodium-sealed (AngelOne)
  api_key       TEXT,                       -- libsodium-sealed
  client_id     TEXT,                       -- libsodium-sealed (Dhan)
  totp_seed     TEXT,                       -- libsodium-sealed (AngelOne, Zerodha auto-login)
  issued_at     TEXT,
  expires_at    TEXT,
  is_default    INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, broker, broker_user_id)
);
CREATE INDEX IF NOT EXISTS idx_brokeracc_user ON broker_accounts(user_id);

-- ---------- Watchlist ----------
CREATE TABLE IF NOT EXISTS watchlist (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol      TEXT NOT NULL,
  exchange    TEXT NOT NULL DEFAULT 'NSE',
  added_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, symbol, exchange)
);
CREATE INDEX IF NOT EXISTS idx_watchlist_user ON watchlist(user_id);

-- ---------- Price alerts ----------
CREATE TABLE IF NOT EXISTS price_alerts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol      TEXT NOT NULL,
  operator    TEXT NOT NULL,                -- 'gte' | 'lte' | 'crosses-up' | 'crosses-down'
  trigger_price REAL NOT NULL,
  channel     TEXT,                          -- 'telegram' | 'email' | 'whatsapp' | 'all'
  active      INTEGER NOT NULL DEFAULT 1,
  fired_at    TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_alerts_user_symbol ON price_alerts(user_id, symbol);

-- ---------- Paper trading ----------
CREATE TABLE IF NOT EXISTS paper_state (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  tier        TEXT NOT NULL DEFAULT '10L', -- '10L' | '25L' | '50L'
  cash        REAL NOT NULL DEFAULT 1000000,
  initial_capital REAL NOT NULL DEFAULT 1000000,
  realized_pnl REAL NOT NULL DEFAULT 0,
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS paper_orders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_order_id TEXT NOT NULL,
  strategy_tag TEXT,
  symbol       TEXT NOT NULL,
  side         TEXT NOT NULL,                -- 'BUY' | 'SELL'
  qty          INTEGER NOT NULL,
  order_type   TEXT NOT NULL,
  product      TEXT,
  req_price    REAL,
  fill_price   REAL,
  slippage     REAL,
  status       TEXT NOT NULL,                -- 'pending' | 'filled' | 'rejected' | 'cancelled'
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  filled_at    TEXT
);
CREATE INDEX IF NOT EXISTS idx_porders_user_ts ON paper_orders(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS paper_positions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol      TEXT NOT NULL,
  qty         INTEGER NOT NULL,
  avg_price   REAL NOT NULL,
  opened_at   TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(user_id, symbol)
);

CREATE TABLE IF NOT EXISTS paper_closed_trades (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol      TEXT NOT NULL,
  side        TEXT NOT NULL,
  qty         INTEGER NOT NULL,
  entry_price REAL NOT NULL,
  exit_price  REAL NOT NULL,
  pnl         REAL NOT NULL,
  strategy_tag TEXT,
  entered_at  TEXT NOT NULL,
  exited_at   TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_pclosed_user ON paper_closed_trades(user_id, exited_at DESC);

-- ---------- Daily P&L attribution ----------
CREATE TABLE IF NOT EXISTS pnl_daily (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,                 -- YYYY-MM-DD
  realized_pnl REAL NOT NULL DEFAULT 0,
  unrealized_pnl REAL NOT NULL DEFAULT 0,
  equity      REAL NOT NULL DEFAULT 0,
  trades      INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id, date)
);
CREATE INDEX IF NOT EXISTS idx_pnl_user_date ON pnl_daily(user_id, date DESC);

-- ---------- Auto-runner ----------
CREATE TABLE IF NOT EXISTS autorun_config (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled          INTEGER NOT NULL DEFAULT 0,
  strategy         TEXT,
  symbol           TEXT,
  qty              INTEGER NOT NULL DEFAULT 1,
  interval         TEXT NOT NULL DEFAULT 'day',
  interval_minutes INTEGER NOT NULL DEFAULT 60,
  candle_lookback_days INTEGER NOT NULL DEFAULT 60,
  updated_at       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS autorun_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  ts          TEXT NOT NULL DEFAULT (datetime('now')),
  strategy    TEXT,
  symbol      TEXT,
  signal      TEXT,                          -- 'BUY' | 'SELL' | 'HOLD'
  action      TEXT,                          -- 'placed' | 'noop' | 'skipped'
  note        TEXT
);
CREATE INDEX IF NOT EXISTS idx_autorun_user_ts ON autorun_history(user_id, ts DESC);

-- ---------- Long-term buckets + SIPs ----------
CREATE TABLE IF NOT EXISTS longterm_state (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  buckets_json TEXT NOT NULL,                -- JSON: { emergency, shortTerm, longTerm } percentages
  updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sips (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  symbol      TEXT NOT NULL,
  amount      REAL NOT NULL,
  frequency   TEXT NOT NULL,                 -- 'monthly' | 'weekly' | 'fortnightly'
  next_date   TEXT NOT NULL,
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_sips_user ON sips(user_id);

-- ---------- Profit sweep rules ----------
CREATE TABLE IF NOT EXISTS sweep_rules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        TEXT NOT NULL,
  trigger_pnl REAL NOT NULL,
  sweep_pct   REAL NOT NULL,
  target      TEXT,                          -- 'savings' | 'mf-bucket' | etc.
  active      INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS sweep_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_id     INTEGER REFERENCES sweep_rules(id) ON DELETE SET NULL,
  amount      REAL NOT NULL,
  fired_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ---------- Scanner debounce + history ----------
CREATE TABLE IF NOT EXISTS scanner_history (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE CASCADE,
  ts          TEXT NOT NULL DEFAULT (datetime('now')),
  symbol      TEXT NOT NULL,
  signal_key  TEXT NOT NULL,
  payload_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_scanner_ts ON scanner_history(ts DESC);

-- ---------- News (global, not per-user) ----------
CREATE TABLE IF NOT EXISTS news_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          TEXT NOT NULL DEFAULT (datetime('now')),
  source      TEXT NOT NULL,
  title       TEXT NOT NULL,
  url         TEXT NOT NULL UNIQUE,
  summary     TEXT,
  tags_json   TEXT                           -- ["RELIANCE","HDFCBANK"]
);
CREATE INDEX IF NOT EXISTS idx_news_ts ON news_items(ts DESC);

-- ---------- T-262: per-user risk-management config (replaces SETUP-TRADING.cmd CLI) ----------
-- Configured from Settings -> Risk Management in the UI. The autorun engine
-- and DCA cron read from this table via riskConfigService.cachedGet(userId).
-- Engine wiring tracked in T-263; for now persistence is intent-only and the
-- engines still respect env-var / hardcoded defaults.
CREATE TABLE IF NOT EXISTS user_risk_config (
  user_id              INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  capital              INTEGER NOT NULL DEFAULT 50000,
  max_position_pct     REAL    NOT NULL DEFAULT 0.05,
  max_daily_loss_pct   REAL    NOT NULL DEFAULT 0.02,
  max_open_positions   INTEGER NOT NULL DEFAULT 3,
  dca_allocation_json  TEXT    NOT NULL DEFAULT '{"NIFTYBEES":0.0292,"JUNIORBEES":0.0098,"GOLDBEES":0.0078,"MOM100":0.0078}',
  active_strategies_json TEXT  NOT NULL DEFAULT '["supertrend","rsi_mean_revert","vwap"]',
  voting_threshold     INTEGER NOT NULL DEFAULT 2,
  trading_mode         TEXT    NOT NULL DEFAULT 'paper' CHECK (trading_mode IN ('paper','micro_live','full_live')),
  -- T-265..T-267 risk gates (added in clean Phase 1 implementation)
  max_daily_trades     INTEGER NOT NULL DEFAULT 5,
  golden_start_hhmm    TEXT    NOT NULL DEFAULT '09:20',
  golden_end_hhmm      TEXT    NOT NULL DEFAULT '15:10',
  tsl_activate_pct     REAL    NOT NULL DEFAULT 0.005,
  tsl_gap_pct          REAL    NOT NULL DEFAULT 0.003,
  updated_at           TEXT    NOT NULL DEFAULT (datetime('now'))
);

// T-262: per-user risk-management config service.
//
// Replaces the operator-only scripts/SETUP-TRADING.cmd CLI with a row in
// user_risk_config (see schema.sql). The CLI was a one-shot bootstrap that
// computed risk caps + DCA SIP amounts from a single `capital` input; this
// service persists those inputs (capital + percentages + strategy mix +
// trading mode) per user and lets the UI plus the engine read/write them.
//
// Storage: SQLite via the shared `db` wrapper (db._conn for raw connection
// or db.transaction for atomic batches). JSON columns are stored as TEXT and
// parsed/serialised at the edges of this module so the caller always sees
// real objects/arrays.
//
// Public API:
//   const svc = createRiskConfigService(db);
//   svc.get(userId)              -> { capital, maxPositionPct, ..., dcaAllocation:{}, activeStrategies:[], tradingMode, updatedAt }
//   svc.upsert(userId, partial)  -> validates + writes -> returns the full updated row
//   svc.DEFAULTS                  -> the same constant the schema uses (frozen)
//
// Engine wiring: autorun + DCA cron call svc.get(userId) but cache the
// result in-memory for 60s (see cachedGet) to avoid hammering the DB. The
// cache is invalidated on every upsert.

'use strict';

const DEFAULTS = Object.freeze({
  capital: 50000,
  maxPositionPct: 0.05,
  maxDailyLossPct: 0.02,
  maxOpenPositions: 3,
  dcaAllocation: Object.freeze({
    NIFTYBEES: 0.0292,
    JUNIORBEES: 0.0098,
    GOLDBEES: 0.0078,
    MOM100: 0.0078,
  }),
  activeStrategies: Object.freeze(['supertrend', 'rsi_mean_revert', 'vwap']),
  // T-506 (P1 #13): per-strategy notional cap. Object {strategyId: maxNotionalInr}.
  // Defaults to {} -- no per-strategy limit, the global MAX_AGGREGATE_EXPOSURE
  // still applies. Once populated, the sum of (open exposure + new order's
  // notional) for that strategy must not exceed the cap.
  strategyCaps: Object.freeze({}),
  // T-501: per-strategy live/paper toggle. Strategies listed here are eligible
  // for LIVE orders (subject to tradingMode != paper + KILL_SWITCH=false +
  // LIVE_TRADING=true). Strategies NOT here go to paper even when the global
  // tradingMode is micro_live / full_live. Promote-scheduler (T-499) writes
  // this nightly based on paper performance vs promotion-policy.
  liveEnabledStrategies: Object.freeze([]),
  votingThreshold: 2,
  tradingMode: 'paper',
  // T-276: SIP firing day-of-month (1..28). 5 = post-salary default.
  sipDayOfMonth: 5,
  // ---- T-265..T-267 risk gates ----
  maxDailyTrades: 5,         // T-266: pause new entries after N closed trades today
  goldenStartHHMM: '09:20',  // T-267: don't fire before this (avoids opening chaos)
  goldenEndHHMM:   '15:10',  // T-267: force-close before 15:30 auto-square-off
  tslActivatePct:  0.005,    // T-265: only start trailing after 0.5% profit
  tslGapPct:       0.003,    // T-265: SL trails 0.3% behind LTP once active
  // T-263b: portfolio-level caps consumed by services/pre-trade.js
  maxLeverage:     2.0,      // gross / cash ratio ceiling
  maxSectorWeight: 0.30,     // per-sector concentration ceiling
  // T-487 (frontend C3 fix): strategy mode toggles + capital allocation per mode.
  // Was localStorage-only in trading-modes.jsx -- two tabs would disagree, no
  // server-side gate. Now persisted in user_risk_config so backend autorun can
  // also honor mode disabling. Empty default means "fall back to frontend
  // MODE_META.defaults" (see src/trading-modes.jsx).
  activeModes: Object.freeze({}),
});

const TRADING_MODES = Object.freeze(['paper', 'micro_live', 'full_live']);

function _validate(partial, currentMerged) {
  // currentMerged is the row that would result if partial were applied on top
  // of the existing row (or defaults). We validate the *merged* shape so a
  // partial that only changes one field still respects cross-field rules.
  const m = currentMerged;
  if (!Number.isFinite(m.capital) || m.capital < 1000 || m.capital > 10000000) {
    throw new Error('capital must be between 1000 and 10000000');
  }
  if (!Number.isFinite(m.maxPositionPct) || m.maxPositionPct < 0 || m.maxPositionPct > 1) {
    throw new Error('maxPositionPct must be between 0 and 1');
  }
  if (!Number.isFinite(m.maxDailyLossPct) || m.maxDailyLossPct < 0 || m.maxDailyLossPct > 1) {
    throw new Error('maxDailyLossPct must be between 0 and 1');
  }
  if (!Number.isInteger(m.maxOpenPositions) || m.maxOpenPositions < 1 || m.maxOpenPositions > 50) {
    throw new Error('maxOpenPositions must be an integer between 1 and 50');
  }
  if (!m.dcaAllocation || typeof m.dcaAllocation !== 'object' || Array.isArray(m.dcaAllocation)) {
    throw new Error('dcaAllocation must be an object');
  }
  let dcaSum = 0;
  for (const [k, v] of Object.entries(m.dcaAllocation)) {
    if (typeof k !== 'string' || !k) throw new Error('dcaAllocation keys must be non-empty symbol strings');
    if (!Number.isFinite(v) || v < 0 || v > 1) throw new Error(`dcaAllocation[${k}] must be between 0 and 1`);
    dcaSum += v;
  }
  // Allow a tiny float-arithmetic tolerance.
  if (dcaSum > 1.000001) throw new Error(`dcaAllocation values sum to ${dcaSum.toFixed(4)} (>1)`);
  if (!Array.isArray(m.activeStrategies) || m.activeStrategies.length === 0) {
    throw new Error('activeStrategies must be a non-empty array');
  }
  for (const s of m.activeStrategies) {
    if (typeof s !== 'string' || !s) throw new Error('activeStrategies entries must be non-empty strings');
  }
  if (!Number.isInteger(m.votingThreshold) || m.votingThreshold < 1 || m.votingThreshold > m.activeStrategies.length) {
    throw new Error(`votingThreshold must be an integer between 1 and ${m.activeStrategies.length}`);
  }
  if (!TRADING_MODES.includes(m.tradingMode)) {
    throw new Error(`tradingMode must be one of: ${TRADING_MODES.join(', ')}`);
  }
  // ---- T-265..T-267 validation ----
  if (!Number.isInteger(m.sipDayOfMonth) || m.sipDayOfMonth < 1 || m.sipDayOfMonth > 28) {
    throw new Error('sipDayOfMonth must be an integer between 1 and 28');
  }
  if (!Number.isInteger(m.maxDailyTrades) || m.maxDailyTrades < 1 || m.maxDailyTrades > 100) {
    throw new Error('maxDailyTrades must be an integer between 1 and 100');
  }
  if (!_isValidHHMM(m.goldenStartHHMM)) throw new Error('goldenStartHHMM must be HH:MM (24h)');
  if (!_isValidHHMM(m.goldenEndHHMM))   throw new Error('goldenEndHHMM must be HH:MM (24h)');
  if (_hhmmToMinutes(m.goldenEndHHMM) <= _hhmmToMinutes(m.goldenStartHHMM)) {
    throw new Error('goldenEndHHMM must be after goldenStartHHMM');
  }
  if (!Number.isFinite(m.tslActivatePct) || m.tslActivatePct < 0 || m.tslActivatePct > 0.5) {
    throw new Error('tslActivatePct must be between 0 and 0.5');
  }
  if (!Number.isFinite(m.tslGapPct) || m.tslGapPct < 0 || m.tslGapPct > 0.5) {
    throw new Error('tslGapPct must be between 0 and 0.5');
  }
  if (m.tslGapPct > m.tslActivatePct) {
    throw new Error('tslGapPct must be <= tslActivatePct (otherwise TSL trails behind entry)');
  }
  // T-263b validation
  if (!Number.isFinite(m.maxLeverage) || m.maxLeverage < 1.0 || m.maxLeverage > 10.0) {
    throw new Error('maxLeverage must be between 1.0 and 10.0');
  }
  if (!Number.isFinite(m.maxSectorWeight) || m.maxSectorWeight <= 0 || m.maxSectorWeight > 1.0) {
    throw new Error('maxSectorWeight must be in (0, 1]');
  }
  return true;
}

// ---- T-267 helpers ----
function _isValidHHMM(s) {
  if (typeof s !== 'string') return false;
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
}
function _hhmmToMinutes(s) {
  const [h, m] = s.split(':').map(Number);
  return h * 60 + m;
}

function _rowToConfig(row) {
  // Maps the raw SQLite row (snake_case + JSON-text columns) to the public
  // camelCase + parsed-JSON shape that callers expect.
  if (!row) return null;
  let dca = null;
  let strategies = null;
  let modes = null;
  try { dca = JSON.parse(row.dca_allocation_json); } catch (_) { dca = null; }
  try { strategies = JSON.parse(row.active_strategies_json); } catch (_) { strategies = null; }
  // T-487: activeModes is optional (may be NULL on pre-migration rows).
  try { if (row.active_modes_json) modes = JSON.parse(row.active_modes_json); } catch (_) { modes = null; }
  // T-501: live-enabled subset (sidecar to activeStrategies).
  let liveEnabled = null;
  try { if (row.live_enabled_strategies_json) liveEnabled = JSON.parse(row.live_enabled_strategies_json); } catch (_) { liveEnabled = null; }
  // T-506: per-strategy notional cap.
  let stratCaps = null;
  try { if (row.strategy_caps_json) stratCaps = JSON.parse(row.strategy_caps_json); } catch (_) { stratCaps = null; }
  return {
    capital: row.capital,
    maxPositionPct: row.max_position_pct,
    maxDailyLossPct: row.max_daily_loss_pct,
    maxOpenPositions: row.max_open_positions,
    dcaAllocation: (dca && typeof dca === 'object' && !Array.isArray(dca)) ? dca : { ...DEFAULTS.dcaAllocation },
    activeStrategies: Array.isArray(strategies) ? strategies : [...DEFAULTS.activeStrategies],
    votingThreshold: row.voting_threshold,
    tradingMode: row.trading_mode,
    // T-265..T-267 columns; default to DEFAULTS if missing (pre-migration rows)
    maxDailyTrades:  Number.isFinite(row.max_daily_trades) ? row.max_daily_trades : DEFAULTS.maxDailyTrades,
    goldenStartHHMM: row.golden_start_hhmm || DEFAULTS.goldenStartHHMM,
    goldenEndHHMM:   row.golden_end_hhmm   || DEFAULTS.goldenEndHHMM,
    tslActivatePct:  Number.isFinite(row.tsl_activate_pct) ? row.tsl_activate_pct : DEFAULTS.tslActivatePct,
    tslGapPct:       Number.isFinite(row.tsl_gap_pct)      ? row.tsl_gap_pct      : DEFAULTS.tslGapPct,
    sipDayOfMonth:   Number.isInteger(row.sip_day_of_month) ? row.sip_day_of_month : DEFAULTS.sipDayOfMonth,
    // T-263b
    maxLeverage:     Number.isFinite(row.max_leverage)        ? row.max_leverage        : DEFAULTS.maxLeverage,
    maxSectorWeight: Number.isFinite(row.max_sector_weight)   ? row.max_sector_weight   : DEFAULTS.maxSectorWeight,
    // T-487
    activeModes:     (modes && typeof modes === 'object' && !Array.isArray(modes)) ? modes : {},
    liveEnabledStrategies: Array.isArray(liveEnabled) ? liveEnabled : [],
    strategyCaps: (stratCaps && typeof stratCaps === 'object' && !Array.isArray(stratCaps)) ? stratCaps : {},
    updatedAt: row.updated_at,
  };
}

function _defaultsForUser() {
  // A fresh deep-copy of DEFAULTS so callers can't mutate the frozen object.
  return {
    capital: DEFAULTS.capital,
    maxPositionPct: DEFAULTS.maxPositionPct,
    maxDailyLossPct: DEFAULTS.maxDailyLossPct,
    maxOpenPositions: DEFAULTS.maxOpenPositions,
    dcaAllocation: { ...DEFAULTS.dcaAllocation },
    activeStrategies: [...DEFAULTS.activeStrategies],
    votingThreshold: DEFAULTS.votingThreshold,
    tradingMode: DEFAULTS.tradingMode,
    maxDailyTrades: DEFAULTS.maxDailyTrades,
    goldenStartHHMM: DEFAULTS.goldenStartHHMM,
    goldenEndHHMM: DEFAULTS.goldenEndHHMM,
    tslActivatePct: DEFAULTS.tslActivatePct,
    tslGapPct: DEFAULTS.tslGapPct,
    sipDayOfMonth: DEFAULTS.sipDayOfMonth,
    maxLeverage: DEFAULTS.maxLeverage,
    maxSectorWeight: DEFAULTS.maxSectorWeight,
    // T-487
    activeModes: { ...DEFAULTS.activeModes },
    liveEnabledStrategies: [...DEFAULTS.liveEnabledStrategies],
    strategyCaps: { ...DEFAULTS.strategyCaps },
    updatedAt: null,
  };
}

function createRiskConfigService(db) {
  if (!db || !db._conn) throw new Error('createRiskConfigService: db with _conn required');
  const conn = db._conn;

  // ---- T-265..T-267 migration: defensively ADD COLUMNs for tables created
  // before these columns existed in schema.sql. SQLite has no IF NOT EXISTS
  // on ALTER TABLE ADD COLUMN, so we swallow the duplicate-column error.
  const MIGRATION_COLS = [
    ['max_daily_trades',    'INTEGER NOT NULL DEFAULT 5'],
    ['golden_start_hhmm',   "TEXT NOT NULL DEFAULT '09:20'"],
    ['golden_end_hhmm',     "TEXT NOT NULL DEFAULT '15:10'"],
    ['tsl_activate_pct',    'REAL NOT NULL DEFAULT 0.005'],
    ['tsl_gap_pct',         'REAL NOT NULL DEFAULT 0.003'],
    ['sip_day_of_month',    'INTEGER NOT NULL DEFAULT 5'],
    ['max_leverage',        'REAL NOT NULL DEFAULT 2.0'],
    ['max_sector_weight',   'REAL NOT NULL DEFAULT 0.30'],
    // T-487
    ['active_modes_json',   "TEXT NOT NULL DEFAULT '{}'"],
    // T-501: per-strategy live toggle (subset of active_strategies_json).
    ['live_enabled_strategies_json', "TEXT NOT NULL DEFAULT '[]'"],
    // T-506: per-strategy notional cap JSON.
    ['strategy_caps_json',          "TEXT NOT NULL DEFAULT '{}'"],
  ];
  for (const [col, ddl] of MIGRATION_COLS) {
    try {
      conn.exec(`ALTER TABLE user_risk_config ADD COLUMN ${col} ${ddl}`);
      console.log(`[risk-config] migrated: added column ${col}`);
    } catch (e) {
      if (!/duplicate column/i.test(e.message)) {
        console.warn(`[risk-config] migration ${col} failed:`, e.message);
      }
    }
  }

  // Compile statements once and reuse.
  const stmtGet = conn.prepare('SELECT * FROM user_risk_config WHERE user_id = ?');
  const stmtUpsert = conn.prepare(`
    INSERT INTO user_risk_config (
      user_id, capital, max_position_pct, max_daily_loss_pct, max_open_positions,
      dca_allocation_json, active_strategies_json, live_enabled_strategies_json, strategy_caps_json, voting_threshold, trading_mode,
      max_daily_trades, golden_start_hhmm, golden_end_hhmm, tsl_activate_pct, tsl_gap_pct,
      sip_day_of_month, max_leverage, max_sector_weight,
      active_modes_json,
      updated_at
    ) VALUES (
      @user_id, @capital, @max_position_pct, @max_daily_loss_pct, @max_open_positions,
      @dca_allocation_json, @active_strategies_json, @live_enabled_strategies_json, @strategy_caps_json, @voting_threshold, @trading_mode,
      @max_daily_trades, @golden_start_hhmm, @golden_end_hhmm, @tsl_activate_pct, @tsl_gap_pct,
      @sip_day_of_month, @max_leverage, @max_sector_weight,
      @active_modes_json,
      datetime('now')
    )
    ON CONFLICT(user_id) DO UPDATE SET
      capital                = @capital,
      max_position_pct       = @max_position_pct,
      max_daily_loss_pct     = @max_daily_loss_pct,
      max_open_positions     = @max_open_positions,
      dca_allocation_json    = @dca_allocation_json,
      active_strategies_json = @active_strategies_json,
      live_enabled_strategies_json = @live_enabled_strategies_json,
      strategy_caps_json = @strategy_caps_json,
      voting_threshold       = @voting_threshold,
      trading_mode           = @trading_mode,
      max_daily_trades       = @max_daily_trades,
      golden_start_hhmm      = @golden_start_hhmm,
      golden_end_hhmm        = @golden_end_hhmm,
      tsl_activate_pct       = @tsl_activate_pct,
      tsl_gap_pct            = @tsl_gap_pct,
      sip_day_of_month       = @sip_day_of_month,
      max_leverage           = @max_leverage,
      max_sector_weight      = @max_sector_weight,
      active_modes_json      = @active_modes_json,
      updated_at             = datetime('now')
  `);

  // Per-user in-memory cache for engine reads. 60-second TTL so config edits
  // propagate within a minute without forcing every cron tick to hit SQLite.
  const _cache = new Map(); // userId -> { value, exp }
  const CACHE_TTL_MS = 60 * 1000;

  function get(userId) {
    if (!Number.isInteger(userId)) throw new Error('userId must be an integer');
    const row = stmtGet.get(userId);
    if (!row) return _defaultsForUser();
    return _rowToConfig(row);
  }

  function cachedGet(userId) {
    const now = Date.now();
    const hit = _cache.get(userId);
    if (hit && hit.exp > now) return hit.value;
    const value = get(userId);
    _cache.set(userId, { value, exp: now + CACHE_TTL_MS });
    return value;
  }

  function _invalidate(userId) { _cache.delete(userId); }

  function upsert(userId, partial) {
    if (!Number.isInteger(userId)) throw new Error('userId must be an integer');
    if (!partial || typeof partial !== 'object') throw new Error('partial must be an object');

    // Merge partial onto current row (or defaults). The route layer always
    // sends a full payload, but accepting partials makes the service safe
    // to call from anywhere in the engine.
    const current = get(userId);
    const merged = {
      capital: partial.capital != null ? Number(partial.capital) : current.capital,
      maxPositionPct: partial.maxPositionPct != null ? Number(partial.maxPositionPct) : current.maxPositionPct,
      maxDailyLossPct: partial.maxDailyLossPct != null ? Number(partial.maxDailyLossPct) : current.maxDailyLossPct,
      maxOpenPositions: partial.maxOpenPositions != null ? Math.trunc(Number(partial.maxOpenPositions)) : current.maxOpenPositions,
      dcaAllocation: partial.dcaAllocation != null ? partial.dcaAllocation : current.dcaAllocation,
      activeStrategies: partial.activeStrategies != null ? partial.activeStrategies : current.activeStrategies,
      // T-501: per-strategy live toggle. Accepts arrays only; null/undefined preserves current.
      liveEnabledStrategies: (Array.isArray(partial.liveEnabledStrategies))
        ? partial.liveEnabledStrategies.filter(x => typeof x === 'string' && x)
        : (Array.isArray(current.liveEnabledStrategies) ? current.liveEnabledStrategies : []),
      // T-506: per-strategy notional cap. Object form only; null/undefined preserves current.
      strategyCaps: (partial.strategyCaps != null && typeof partial.strategyCaps === 'object' && !Array.isArray(partial.strategyCaps))
        ? Object.fromEntries(Object.entries(partial.strategyCaps).filter(([k, v]) => typeof k === 'string' && k && Number.isFinite(Number(v)) && Number(v) > 0).map(([k, v]) => [k, Number(v)]))
        : (current.strategyCaps && typeof current.strategyCaps === 'object' ? current.strategyCaps : {}),
      votingThreshold: partial.votingThreshold != null ? Math.trunc(Number(partial.votingThreshold)) : current.votingThreshold,
      tradingMode: partial.tradingMode != null ? String(partial.tradingMode) : current.tradingMode,
      // T-265..T-267
      maxDailyTrades: partial.maxDailyTrades != null ? Math.trunc(Number(partial.maxDailyTrades)) : current.maxDailyTrades,
      goldenStartHHMM: partial.goldenStartHHMM != null ? String(partial.goldenStartHHMM) : current.goldenStartHHMM,
      goldenEndHHMM:   partial.goldenEndHHMM   != null ? String(partial.goldenEndHHMM)   : current.goldenEndHHMM,
      tslActivatePct:  partial.tslActivatePct  != null ? Number(partial.tslActivatePct)  : current.tslActivatePct,
      tslGapPct:       partial.tslGapPct       != null ? Number(partial.tslGapPct)       : current.tslGapPct,
      sipDayOfMonth:   partial.sipDayOfMonth   != null ? Math.trunc(Number(partial.sipDayOfMonth)) : current.sipDayOfMonth,
      // T-263b
      maxLeverage:     partial.maxLeverage     != null ? Number(partial.maxLeverage)     : current.maxLeverage,
      maxSectorWeight: partial.maxSectorWeight != null ? Number(partial.maxSectorWeight) : current.maxSectorWeight,
      // T-487: activeModes is an arbitrary JSON object {modeId: {enabled, capitalPct, ...}}.
      // No strict validation -- frontend MODE_META owns the shape. Reject non-objects.
      activeModes: (partial.activeModes != null && typeof partial.activeModes === 'object' && !Array.isArray(partial.activeModes))
        ? partial.activeModes
        : current.activeModes,
    };
    _validate(partial, merged);

    stmtUpsert.run({
      user_id: userId,
      capital: Math.trunc(merged.capital),
      max_position_pct: merged.maxPositionPct,
      max_daily_loss_pct: merged.maxDailyLossPct,
      max_open_positions: merged.maxOpenPositions,
      dca_allocation_json: JSON.stringify(merged.dcaAllocation),
      active_strategies_json: JSON.stringify(merged.activeStrategies),
      live_enabled_strategies_json: JSON.stringify(merged.liveEnabledStrategies || []),
      strategy_caps_json: JSON.stringify(merged.strategyCaps || {}),
      voting_threshold: merged.votingThreshold,
      trading_mode: merged.tradingMode,
      max_daily_trades: merged.maxDailyTrades,
      golden_start_hhmm: merged.goldenStartHHMM,
      golden_end_hhmm: merged.goldenEndHHMM,
      tsl_activate_pct: merged.tslActivatePct,
      tsl_gap_pct: merged.tslGapPct,
      sip_day_of_month: merged.sipDayOfMonth,
      max_leverage:      merged.maxLeverage,
      max_sector_weight: merged.maxSectorWeight,
      active_modes_json: JSON.stringify(merged.activeModes || {}),
    });
    _invalidate(userId);
    return get(userId);
  }

  return { get, cachedGet, upsert, DEFAULTS, _invalidate };
}

module.exports = { createRiskConfigService, DEFAULTS };

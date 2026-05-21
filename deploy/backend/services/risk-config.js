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
  votingThreshold: 2,
  tradingMode: 'paper',
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
  return true;
}

function _rowToConfig(row) {
  // Maps the raw SQLite row (snake_case + JSON-text columns) to the public
  // camelCase + parsed-JSON shape that callers expect.
  if (!row) return null;
  let dca = null;
  let strategies = null;
  try { dca = JSON.parse(row.dca_allocation_json); } catch (_) { dca = null; }
  try { strategies = JSON.parse(row.active_strategies_json); } catch (_) { strategies = null; }
  return {
    capital: row.capital,
    maxPositionPct: row.max_position_pct,
    maxDailyLossPct: row.max_daily_loss_pct,
    maxOpenPositions: row.max_open_positions,
    dcaAllocation: (dca && typeof dca === 'object' && !Array.isArray(dca)) ? dca : { ...DEFAULTS.dcaAllocation },
    activeStrategies: Array.isArray(strategies) ? strategies : [...DEFAULTS.activeStrategies],
    votingThreshold: row.voting_threshold,
    tradingMode: row.trading_mode,
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
    updatedAt: null,
  };
}

function createRiskConfigService(db) {
  if (!db || !db._conn) throw new Error('createRiskConfigService: db with _conn required');
  const conn = db._conn;

  // Compile statements once and reuse.
  const stmtGet = conn.prepare('SELECT * FROM user_risk_config WHERE user_id = ?');
  const stmtUpsert = conn.prepare(`
    INSERT INTO user_risk_config (
      user_id, capital, max_position_pct, max_daily_loss_pct, max_open_positions,
      dca_allocation_json, active_strategies_json, voting_threshold, trading_mode, updated_at
    ) VALUES (
      @user_id, @capital, @max_position_pct, @max_daily_loss_pct, @max_open_positions,
      @dca_allocation_json, @active_strategies_json, @voting_threshold, @trading_mode, datetime('now')
    )
    ON CONFLICT(user_id) DO UPDATE SET
      capital                = @capital,
      max_position_pct       = @max_position_pct,
      max_daily_loss_pct     = @max_daily_loss_pct,
      max_open_positions     = @max_open_positions,
      dca_allocation_json    = @dca_allocation_json,
      active_strategies_json = @active_strategies_json,
      voting_threshold       = @voting_threshold,
      trading_mode           = @trading_mode,
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
      votingThreshold: partial.votingThreshold != null ? Math.trunc(Number(partial.votingThreshold)) : current.votingThreshold,
      tradingMode: partial.tradingMode != null ? String(partial.tradingMode) : current.tradingMode,
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
      voting_threshold: merged.votingThreshold,
      trading_mode: merged.tradingMode,
    });
    _invalidate(userId);
    return get(userId);
  }

  return { get, cachedGet, upsert, DEFAULTS, _invalidate };
}

module.exports = { createRiskConfigService, DEFAULTS };

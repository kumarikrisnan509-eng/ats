// T-273 -- Pre-trade check pipeline (Phase 2, vision doc §4.1).
//
// Consolidates the three existing live-order gates from routes/orders.js
// (KILL_SWITCH env, LIVE_TRADING env, tradingMode user-config) AND adds two
// new portfolio-level gates that previously had no enforcement:
//
//   - LEVERAGE_CAP_EXCEEDED       gross / cash > maxLeverage (default 2.0x)
//   - SECTOR_CONCENTRATION        the sector this order would push past 30%
//
// The intent: every order through /api/orders/place runs through this single
// gate function. autorun has its OWN 8-gate chain (T-263..T-282) so this
// service does NOT touch autorun -- live orders only.
//
// v1 deliberately MINIMAL. Future tickets (T-273b/c) will add:
//   - Net delta cap (needs options Greeks; Phase 4)
//   - Correlation-with-existing cap (needs returns history)
//   - Earnings/RBI blackout (needs calendar feed)
//
// Public API:
//   const pt = createPreTradeCheck({ KILL_SWITCH, LIVE_TRADING, getRiskConfig,
//                                     getPortfolioAggregates, audit });
//   pt.check({ userId, payload }) -> { ok: true } | { ok: false, status, reason, message, detail }
//
// Result shape mirrors what routes/orders.js currently returns so callers
// can just spread it into res.json().

'use strict';

// T-484: soft-kill flag (in-memory, set via POST /api/admin/soft-kill).
// Single instance via require-cache; the routes module and this module
// share the same flag.
const softKill = require('./soft-kill');

const DEFAULT_MAX_LEVERAGE       = 2.0;
const DEFAULT_MAX_SECTOR_WEIGHT  = 0.30;  // 30%

function createPreTradeCheck({
  KILL_SWITCH,
  LIVE_TRADING,
  getRiskConfig,
  getPortfolioAggregates,
  audit,
}) {
  const _audit = audit || (() => {});

  /**
   * Run all gates in order. Returns the first failure or { ok: true }.
   * Caller passes: { userId, payload }
   *   payload = the order request body (already validated for shape; this
   *             service only does portfolio-level + policy gates, not
   *             field-level validation which orders.js still owns).
   */
  function check({ userId, payload }) {
    // ----------- GATE 0 (T-484): soft-kill (in-memory) -----------
    // Fires BEFORE the env KILL_SWITCH check. The operator can flip this
    // from the UI Kill button without a container restart. Env KILL_SWITCH
    // remains the persistent gate that survives restarts.
    if (softKill.get()) {
      _audit('preTrade.blocked.softKill', { userId, payload, softKillState: softKill.state() });
      return {
        ok: false,
        status: 503,
        reason: 'SOFT_KILL_ON',
        message: 'Live orders are disabled by operator soft-kill (fired from UI). Reset via POST /api/admin/soft-kill-reset. The persistent KILL_SWITCH env var is separate and unaffected.',
        detail: softKill.state(),
      };
    }

    // ----------- GATE 1: KILL_SWITCH env -----------
    if (KILL_SWITCH) {
      _audit('preTrade.blocked.killSwitch', { userId, payload });
      return {
        ok: false,
        status: 503,
        reason: 'KILL_SWITCH_ON',
        message: 'Live orders are disabled while KILL_SWITCH=true. Set KILL_SWITCH=false in /etc/ats/backend.env to enable.',
      };
    }

    // ----------- GATE 2: LIVE_TRADING env -----------
    if (!LIVE_TRADING) {
      _audit('preTrade.blocked.liveTradingDisabled', { userId, payload });
      return {
        ok: false,
        status: 503,
        reason: 'LIVE_TRADING_DISABLED',
        message: 'KILL_SWITCH is off but LIVE_TRADING env is not true. Set LIVE_TRADING=true in /etc/ats/backend.env to enable real orders.',
      };
    }

    // ----------- GATE 3: per-user tradingMode -----------
    let cfg = null;
    if (typeof getRiskConfig === 'function' && Number.isInteger(userId)) {
      try { cfg = getRiskConfig(userId); }
      catch (e) {
        // Permissive on config-read failure. Audited, not blocking.
        _audit('preTrade.riskConfigLookup.failed', { userId, msg: e.message });
      }
    }
    if (cfg && cfg.tradingMode === 'paper') {
      _audit('preTrade.blocked.paperMode', { userId, payload });
      return {
        ok: false,
        status: 403,
        reason: 'LIVE_ORDERS_DISABLED_BY_MODE',
        message: 'Your account is in Paper mode. Open Settings -> Risk management and switch to Micro-live or Full-live to allow live orders.',
        detail: { currentMode: 'paper' },
      };
    }

    // ----------- GATE 4 (NEW): leverage cap -----------
    if (typeof getPortfolioAggregates === 'function') {
      try {
        const agg = getPortfolioAggregates();
        if (agg && Number.isFinite(agg.leverage)) {
          const maxLev = (cfg && Number.isFinite(cfg.maxLeverage)) ? cfg.maxLeverage : DEFAULT_MAX_LEVERAGE;
          if (agg.leverage >= maxLev) {
            _audit('preTrade.blocked.leverage', { userId, current: agg.leverage, cap: maxLev });
            return {
              ok: false,
              status: 403,
              reason: 'LEVERAGE_CAP_EXCEEDED',
              message: `Current portfolio leverage ${agg.leverage.toFixed(2)}x meets or exceeds the cap of ${maxLev.toFixed(2)}x. Close positions or reduce qty.`,
              detail: { currentLeverage: agg.leverage, maxLeverage: maxLev },
            };
          }
        }
      } catch (e) {
        // Permissive: aggregator failure must not block trading.
        _audit('preTrade.aggregateLookup.failed', { userId, msg: e.message });
      }
    }

    // ----------- GATE 5 (NEW): sector concentration -----------
    // Refuse if this order would push the symbol's sector past the cap.
    // Requires knowing the symbol -> sector map; we read it from the
    // aggregates output which already includes per-position sector.
    if (typeof getPortfolioAggregates === 'function' && payload && payload.symbol) {
      try {
        const agg = getPortfolioAggregates();
        const sym = String(payload.symbol).replace(/^(NSE|BSE|NFO|BFO|MCX|CDS):/, '').toUpperCase();
        // Find which sector this symbol belongs to from existing positions
        let sectorOfSym = null;
        if (agg && Array.isArray(agg.positions)) {
          const hit = agg.positions.find(p => p.symbol === sym);
          if (hit) sectorOfSym = hit.sector;
        }
        if (sectorOfSym && agg.bySector && agg.bySector[sectorOfSym]) {
          const sectorWeight = (agg.bySector[sectorOfSym].weightPct || 0) / 100;
          const maxSecWt = (cfg && Number.isFinite(cfg.maxSectorWeight)) ? cfg.maxSectorWeight : DEFAULT_MAX_SECTOR_WEIGHT;
          if (sectorWeight >= maxSecWt) {
            _audit('preTrade.blocked.sector', { userId, sector: sectorOfSym, weight: sectorWeight, cap: maxSecWt });
            return {
              ok: false,
              status: 403,
              reason: 'SECTOR_CONCENTRATION_EXCEEDED',
              message: `Sector '${sectorOfSym}' is already ${(sectorWeight * 100).toFixed(1)}% of long market value (cap ${(maxSecWt * 100).toFixed(0)}%). Diversify into another sector first.`,
              detail: { sector: sectorOfSym, currentWeight: sectorWeight, maxWeight: maxSecWt },
            };
          }
        }
      } catch (e) {
        _audit('preTrade.sectorCheck.failed', { userId, msg: e.message });
      }
    }

    // ----------- ALL GATES PASSED -----------
    return { ok: true };
  }

  return { check };
}

module.exports = { createPreTradeCheck };

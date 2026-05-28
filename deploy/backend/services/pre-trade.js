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
  // T-496: getter for the marketMeta singleton (avoids circular boot
  // ordering — server.js can construct preTradeCheck before marketMeta).
  getMarketMeta,
  // T-503: optional Telegram notify for permissive-failure branches.
  // If absent, degraded events are audit-only (pre-T-503 behaviour).
  notify,
  audit,
}) {
  // T-503: silent-degradation counters surfaced via getDegradedSnapshot().
  // Each entry counts "we let the trade through despite gate X failing".
  const _degradedCounts = { aggregator: 0, sectorCheck: 0, marketMeta: 0 };
  const _degradedNotifyAt = { aggregator: 0, sectorCheck: 0, marketMeta: 0 };
  function _gateDegraded(branch, error) {
    try {
      if (_degradedCounts[branch] != null) _degradedCounts[branch]++;
      _audit('preTrade.gate.degraded', { branch, msg: error && error.message, count: _degradedCounts[branch] });
      const now = Date.now();
      if (notify && typeof notify.notify === 'function'
          && (now - (_degradedNotifyAt[branch] || 0)) > 60_000) {
        _degradedNotifyAt[branch] = now;
        notify.notify({
          title: '⚠️ ATS — preTrade gate degraded',
          body: `preTrade.${branch} failed and let the order through (count today: ${_degradedCounts[branch]}). ${error ? error.message : ''}`,
        }).catch(() => {});
      }
    } catch { /* never let telemetry crash the gate */ }
  }
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

    // ----------- GATE 0.5 (T-496): market hours / holiday -----------
    // NSE is closed Sat/Sun, on the holiday calendar, and outside
    // 09:15-15:30 IST. Block live orders here so a wired-up KILL_SWITCH=false
    // can't accidentally fire orders on Diwali / a weekend. Permissive if
    // marketMeta isn't initialised yet (boot race) -- audited bypass.
    try {
      const mm = (typeof getMarketMeta === 'function') ? getMarketMeta() : null;
      if (mm && typeof mm.isMarketOpenNow === 'function') {
        const st = mm.isMarketOpenNow();
        if (st && st.open === false) {
          _audit('preTrade.blocked.marketClosed', { userId, payload, state: st });
          return {
            ok: false,
            status: 503,
            reason: 'MARKET_CLOSED',
            message: `NSE is closed (${st.reason}${st.holidayName ? ' — ' + st.holidayName : ''}${st.time_ist ? ' at ' + st.time_ist + ' IST' : ''}). Live orders accepted only during 09:15-15:30 IST on trading days.`,
            detail: st,
          };
        }
      } else {
        _audit('preTrade.marketMeta.unavailable', { userId });
      }
    } catch (e) {
      _audit('preTrade.marketMeta.failed', { userId, msg: e.message });
      _gateDegraded('marketMeta', e);
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
        _gateDegraded('aggregator', e);
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
        _gateDegraded('sectorCheck', e);
      }
    }

    // ----------- GATE 6 (NEW T-506): per-strategy budget cap -----------
    // If the operator has set a strategyCaps entry for this strategy, the
    // sum of (current per-strategy exposure + this order's notional) must
    // not exceed the cap. Permissive on aggregator failure (audited, not
    // blocking) and silent no-op when no cap is set.
    if (cfg && cfg.strategyCaps && typeof cfg.strategyCaps === 'object'
        && payload && payload.strategy
        && Number.isFinite(Number(cfg.strategyCaps[payload.strategy]))
        && typeof getPortfolioAggregates === 'function') {
      try {
        const cap = Number(cfg.strategyCaps[payload.strategy]);
        const agg = getPortfolioAggregates();
        let currentExposure = 0;
        if (agg && Array.isArray(agg.positions)) {
          for (const p of agg.positions) {
            if (p && p.strategy === payload.strategy && Number.isFinite(p.notionalInr)) {
              currentExposure += Math.abs(p.notionalInr);
            }
          }
        }
        const orderNotional = Number(payload.qty || 0) * Number(payload.estPrice || payload.ltp || 0);
        // estPrice/ltp may be absent in autorun MARKET orders; if so we skip the
        // cap check (the global aggregate cap still protects). Audit so it's visible.
        if (orderNotional > 0 && (currentExposure + orderNotional) > cap) {
          _audit('preTrade.blocked.strategyCap', { userId, strategy: payload.strategy, currentExposure, orderNotional, cap });
          return {
            ok: false,
            status: 403,
            reason: 'STRATEGY_BUDGET_EXCEEDED',
            message: `Strategy '${payload.strategy}' would exceed its per-strategy notional cap of ₹${cap.toLocaleString('en-IN')} (current ₹${currentExposure.toLocaleString('en-IN')} + this order ₹${orderNotional.toLocaleString('en-IN')}).`,
            detail: { strategy: payload.strategy, currentExposure, orderNotional, cap },
          };
        }
        if (orderNotional <= 0) {
          _audit('preTrade.strategyCap.skipped', { userId, strategy: payload.strategy, reason: 'no_price_in_payload' });
        }
      } catch (e) {
        _audit('preTrade.strategyCap.failed', { userId, msg: e.message });
        _gateDegraded('aggregator', e);   // re-uses existing aggregator counter
      }
    }

    // ----------- ALL GATES PASSED -----------
    return { ok: true };
  }

  // T-503: snapshot of permissive-failure counts for /api/health.
  function getDegradedSnapshot() { return Object.assign({}, _degradedCounts); }
  return { check, getDegradedSnapshot };
}

module.exports = { createPreTradeCheck };

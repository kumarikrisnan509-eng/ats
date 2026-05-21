// T-302a + T-303a -- Signal calibration + auto-retire recommendation.
//
// Pure functions. Given closed trades (paper or live) and the autorun
// history of fired signals, compute per-strategy calibration metrics
// (predicted-direction hit rate, sample size, average PnL per closed
// trade, win/loss ratio). Then T-303a layers a recommendation pass
// that flags strategies as RETIRE / WATCH / KEEP based on:
//
//   - hit rate below threshold (default 45%) over >= MIN_TRADES sample
//   - average PnL per trade negative over >= MIN_TRADES sample
//   - drawdown of N consecutive losing trades (default 5)
//
// Recommendations are STRICTLY ADVISORY. The engine still respects
// the operator's activeStrategies list in risk-config. The auto-retire
// recommender just surfaces "this is likely a bad strategy, consider
// removing it from activeStrategies".
//
// Pure: no DB handle, no network. Service-style factory takes injected
// readers so callers can wire it to whatever data source they have.
//
// Public API:
//   const c = createSignalCalibration({ getClosedTrades, getAutorunHistory });
//   c.calibrate(windowDays)                  -> per-strategy metrics
//   c.recommend(windowDays, thresholds?)     -> {retire, watch, keep}

'use strict';

const DEFAULTS = Object.freeze({
  MIN_TRADES: 20,               // minimum sample for recommendation to fire
  RETIRE_HIT_RATE: 0.45,        // below this -> RETIRE
  WATCH_HIT_RATE: 0.50,         // below this (but >= retire) -> WATCH
  CONSECUTIVE_LOSS_LIMIT: 5,    // N losing trades in a row triggers WATCH
  RETIRE_AVG_PNL_PER_TRADE: 0,  // negative average PnL -> RETIRE (over MIN_TRADES)
});

function createSignalCalibration({ getClosedTrades, getAutorunHistory } = {}) {
  if (typeof getClosedTrades !== 'function') throw new Error('getClosedTrades function required');
  if (typeof getAutorunHistory !== 'function') throw new Error('getAutorunHistory function required');

  /**
   * Compute per-strategy stats over the window.
   * @param {number} windowDays  default 30; trades older than this excluded
   * @returns {Array<{strategy, trades, wins, losses, hitRate, avgPnl, totalPnl,
   *                  maxConsecutiveLosses, lastClosedAt, fires, skipped}>}
   */
  function calibrate(windowDays = 30) {
    const cutoff = Date.now() - (Math.max(1, windowDays) * 24 * 3600 * 1000);
    const trades = (getClosedTrades(2000) || []).filter(t => {
      if (!t || !t.strategy) return false;
      const ts = t.closedAt || t.filledAt || t.ts;
      const ms = ts ? new Date(ts).getTime() : 0;
      return ms >= cutoff;
    });

    // Group by strategy
    const byStrat = new Map();
    for (const t of trades) {
      const k = t.strategy;
      if (!byStrat.has(k)) {
        byStrat.set(k, {
          strategy: k, trades: 0, wins: 0, losses: 0, totalPnl: 0,
          consecutiveLosses: 0, maxConsecutiveLosses: 0,
          lastClosedAt: null, _pnls: [],
        });
      }
      const s = byStrat.get(k);
      const pnl = Number(t.pnl ?? t.realizedPnl ?? 0);
      s.trades++;
      s._pnls.push(pnl);
      s.totalPnl += pnl;
      if (pnl > 0) {
        s.wins++;
        s.consecutiveLosses = 0;
      } else if (pnl < 0) {
        s.losses++;
        s.consecutiveLosses++;
        if (s.consecutiveLosses > s.maxConsecutiveLosses) {
          s.maxConsecutiveLosses = s.consecutiveLosses;
        }
      }
      const closedAt = t.closedAt || t.filledAt || t.ts;
      if (closedAt && (!s.lastClosedAt || new Date(closedAt) > new Date(s.lastClosedAt))) {
        s.lastClosedAt = closedAt;
      }
    }

    // Layer in fires / skipped from autorun history (informational)
    const fires = (getAutorunHistory(1000) || []).filter(r => {
      if (!r || !r.ts) return false;
      return new Date(r.ts).getTime() >= cutoff;
    });
    const firesByStrat = new Map();
    for (const r of fires) {
      // autorun history rows carry strategy on r.signal (e.g. "vwap:BUY")
      // or on r.strategy directly. Fall back to 'unknown'.
      const k = r.strategy || (r.signal ? String(r.signal).split(':')[0] : 'unknown');
      if (!firesByStrat.has(k)) firesByStrat.set(k, { fires: 0, placed: 0, skipped: 0 });
      const x = firesByStrat.get(k);
      x.fires++;
      if (r.result === 'placed') x.placed++;
      else if (String(r.result || '').startsWith('skipped')) x.skipped++;
    }

    // Finalize: hit-rate, avg pnl, ordered list
    const out = [];
    const allStrats = new Set([...byStrat.keys(), ...firesByStrat.keys()]);
    for (const k of allStrats) {
      const s = byStrat.get(k) || {
        strategy: k, trades: 0, wins: 0, losses: 0, totalPnl: 0,
        maxConsecutiveLosses: 0, lastClosedAt: null, _pnls: [],
      };
      const f = firesByStrat.get(k) || { fires: 0, placed: 0, skipped: 0 };
      const hitRate = s.trades > 0 ? s.wins / s.trades : null;
      const avgPnl = s.trades > 0 ? s.totalPnl / s.trades : null;
      out.push({
        strategy: k,
        trades: s.trades,
        wins: s.wins,
        losses: s.losses,
        hitRate: hitRate != null ? Math.round(hitRate * 1e4) / 1e4 : null,
        avgPnl: avgPnl != null ? Math.round(avgPnl * 100) / 100 : null,
        totalPnl: Math.round(s.totalPnl * 100) / 100,
        maxConsecutiveLosses: s.maxConsecutiveLosses,
        lastClosedAt: s.lastClosedAt,
        fires: f.fires,
        placed: f.placed,
        skipped: f.skipped,
      });
    }
    out.sort((a, b) => (b.trades || 0) - (a.trades || 0));
    return out;
  }

  /**
   * Translate calibration into retire/watch/keep buckets.
   * @returns {{retire:Array, watch:Array, keep:Array, thresholds, asOf}}
   */
  function recommend(windowDays = 30, overrides = {}) {
    const cfg = { ...DEFAULTS, ...overrides };
    const stats = calibrate(windowDays);
    const retire = [], watch = [], keep = [];
    for (const s of stats) {
      // Not enough sample -> default keep with note
      if (s.trades < cfg.MIN_TRADES) {
        keep.push({ ...s, recommendation: 'keep', reason: `insufficient_sample (${s.trades}/${cfg.MIN_TRADES})` });
        continue;
      }
      // Hard retire: negative average PnL
      if (s.avgPnl != null && s.avgPnl < cfg.RETIRE_AVG_PNL_PER_TRADE) {
        retire.push({ ...s, recommendation: 'retire', reason: `avg_pnl=${s.avgPnl} <= 0 over ${s.trades} trades` });
        continue;
      }
      // Hard retire: hit rate below threshold
      if (s.hitRate != null && s.hitRate < cfg.RETIRE_HIT_RATE) {
        retire.push({ ...s, recommendation: 'retire', reason: `hit_rate=${(s.hitRate*100).toFixed(1)}% < ${(cfg.RETIRE_HIT_RATE*100).toFixed(0)}%` });
        continue;
      }
      // Watch: hit rate borderline
      if (s.hitRate != null && s.hitRate < cfg.WATCH_HIT_RATE) {
        watch.push({ ...s, recommendation: 'watch', reason: `hit_rate=${(s.hitRate*100).toFixed(1)}% < ${(cfg.WATCH_HIT_RATE*100).toFixed(0)}%` });
        continue;
      }
      // Watch: too many consecutive losses
      if (s.maxConsecutiveLosses >= cfg.CONSECUTIVE_LOSS_LIMIT) {
        watch.push({ ...s, recommendation: 'watch', reason: `max_consec_losses=${s.maxConsecutiveLosses} >= ${cfg.CONSECUTIVE_LOSS_LIMIT}` });
        continue;
      }
      keep.push({ ...s, recommendation: 'keep', reason: 'meets thresholds' });
    }
    return {
      asOf: new Date().toISOString(),
      windowDays,
      thresholds: cfg,
      retire, watch, keep,
      summary: { retire: retire.length, watch: watch.length, keep: keep.length },
    };
  }

  return { calibrate, recommend, DEFAULTS };
}

// ---- Smoke tests ----

const SMOKE = () => {
  let pass = 0, fail = 0;
  const check = (lbl, c) => { if (c) { pass++; console.log('  PASS  ' + lbl); } else { fail++; console.log('  FAIL  ' + lbl); } };

  // Synthetic closed trades + autorun history
  const now = Date.now();
  const day = 24 * 3600 * 1000;
  const closedTrades = [];
  // Strategy A: 30 trades interleaved (no consecutive-loss streak >= 5).
  // Pattern: win win loss repeated 10x -> 20 wins, 10 losses, max consec losses = 1.
  for (let i = 0; i < 30; i++) {
    const isLoss = (i % 3 === 2);
    closedTrades.push({ strategy: 'A', pnl: isLoss ? -100 : 200, closedAt: new Date(now - (29 - i) * day).toISOString() });
  }
  // Strategy B: 25 trades, 10 wins, 15 losses -> 40% hit, avg pnl -50 (RETIRE)
  for (let i = 0; i < 25; i++) {
    closedTrades.push({ strategy: 'B', pnl: i < 10 ? 100 : -150, closedAt: new Date(now - (24 - i) * day).toISOString() });
  }
  // Strategy C: 22 trades, 11 wins, 11 losses -> 50% hit (WATCH boundary, but avg pnl +10 so KEEP)
  for (let i = 0; i < 22; i++) {
    closedTrades.push({ strategy: 'C', pnl: i % 2 === 0 ? 110 : -100, closedAt: new Date(now - (21 - i) * day).toISOString() });
  }
  // Strategy D: only 5 trades (under MIN_TRADES) -> KEEP (insufficient sample)
  for (let i = 0; i < 5; i++) {
    closedTrades.push({ strategy: 'D', pnl: -100, closedAt: new Date(now - (4 - i) * day).toISOString() });
  }
  // Strategy E: 30 trades, alternating loss-win except last 6 are all losses -> WATCH (consec_losses)
  for (let i = 0; i < 24; i++) {
    closedTrades.push({ strategy: 'E', pnl: i % 2 === 0 ? 100 : 50, closedAt: new Date(now - (29 - i) * day).toISOString() });
  }
  for (let i = 0; i < 6; i++) {
    closedTrades.push({ strategy: 'E', pnl: -50, closedAt: new Date(now - (5 - i) * day).toISOString() });
  }

  const autorunHistory = [
    { strategy: 'A', result: 'placed', ts: new Date(now - day).toISOString() },
    { strategy: 'A', result: 'skipped_outside_window', ts: new Date(now - 2*day).toISOString() },
    { strategy: 'B', result: 'placed', ts: new Date(now - day).toISOString() },
  ];

  const svc = createSignalCalibration({
    getClosedTrades: (n) => closedTrades,
    getAutorunHistory: (n) => autorunHistory,
  });

  const cal = svc.calibrate(30);
  check('calibrate returns array', Array.isArray(cal));
  check('5 strategies tracked', cal.length === 5);
  const a = cal.find(s => s.strategy === 'A');
  check('A: 30 trades', a && a.trades === 30);
  check('A: hit rate ~0.667', a && Math.abs(a.hitRate - 0.6667) < 0.001);
  check('A: fires merged from autorun history', a && a.fires === 2 && a.placed === 1);

  const rec = svc.recommend(30);
  check('recommend has retire/watch/keep', rec.retire && rec.watch && rec.keep);
  check('B in retire (hit rate + avg pnl)', rec.retire.some(s => s.strategy === 'B'));
  check('D in keep (insufficient sample)', rec.keep.some(s => s.strategy === 'D' && /insufficient/.test(s.reason)));
  check('A in keep (good stats)', rec.keep.some(s => s.strategy === 'A'));
  check('E in watch (consec losses)', rec.watch.some(s => s.strategy === 'E' && /consec/.test(s.reason)));
  check('summary counts match', rec.summary.retire + rec.summary.watch + rec.summary.keep === cal.length);

  // Edge: empty inputs
  const empty = createSignalCalibration({ getClosedTrades: () => [], getAutorunHistory: () => [] });
  check('empty trades -> empty calibration', empty.calibrate(30).length === 0);
  check('empty trades -> all-zero recommendation', empty.recommend(30).summary.retire === 0 && empty.recommend(30).summary.watch === 0);

  console.log(`\nSmoke: ${pass} pass, ${fail} fail.`);
  if (fail > 0) process.exit(1);
};

if (require.main === module && process.argv.includes('--smoke')) {
  SMOKE();
}

module.exports = { createSignalCalibration, DEFAULTS };

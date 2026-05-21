// T-301a -- Walk-forward parameter optimization (Phase 5 learning loop).
//
// Pure function over backtest.runBacktest. Given:
//   - candles: full historical series (need >= inWindow + outWindow bars)
//   - strategy: name registered in backtest.js (e.g. 'rsi_mean_revert')
//   - paramGrid: { paramName: [v1, v2, v3, ...], ... }
//   - opts: { inWindow=60, outWindow=14, step=14, qty, scoreFn }
//
// We slide an (in, out) window pair across the series. For each window:
//   1. Run runBacktest on every Cartesian-product param combo over the
//      IN window. Pick the combo with the best score (Sharpe-like
//      default = totalPnl / max(1, abs(maxDrawdown))).
//   2. Run runBacktest on the OUT window using those best params.
//      Record OOS performance.
//
// Aggregate:
//   - Which param set wins most often?
//   - Average IS vs OOS score (overfit detector).
//   - Recommendation: if a single param set wins >= dominanceThreshold of
//     windows AND average OOS score > 0, recommend updating active params.
//
// THE RECOMMENDATION IS ADVISORY ONLY. The operator decides whether to
// apply it via risk-config. No engine mutation happens here.
//
// Public API:
//   const w = createWalkForward({ runBacktest });
//   const r = w.run({ candles, strategy, paramGrid, opts });

'use strict';

const DEFAULTS = Object.freeze({
  inWindow: 60,
  outWindow: 14,
  step: 14,                  // slide by 14 bars per iteration
  qty: 100,
  dominanceThreshold: 0.5,   // best params must win >= 50% of windows
  minOosPositive: 0,         // average OOS pnl must exceed this to recommend
});

function _cartesian(grid) {
  // grid: { k1: [a,b], k2: [c,d] } -> [{k1:a,k2:c},{k1:a,k2:d},{k1:b,k2:c},{k1:b,k2:d}]
  const keys = Object.keys(grid || {});
  if (keys.length === 0) return [{}];
  let out = [{}];
  for (const k of keys) {
    const vals = Array.isArray(grid[k]) ? grid[k] : [grid[k]];
    const next = [];
    for (const acc of out) {
      for (const v of vals) {
        next.push({ ...acc, [k]: v });
      }
    }
    out = next;
  }
  return out;
}

function _defaultScore(stats) {
  // Sharpe-flavoured: total PnL per unit of drawdown. Penalises high DD.
  if (!stats) return -Infinity;
  const pnl = Number(stats.totalPnl) || 0;
  const dd  = Math.max(1, Math.abs(Number(stats.maxDrawdown) || 0));
  return pnl / dd;
}

function _paramKey(p) {
  // Stable JSON key for grouping
  const keys = Object.keys(p || {}).sort();
  return JSON.stringify(keys.map(k => [k, p[k]]));
}

function createWalkForward({ runBacktest } = {}) {
  if (typeof runBacktest !== 'function') throw new Error('runBacktest function required');

  /**
   * @returns {{
   *   strategy, paramGrid, windows: Array, summary: {...},
   *   recommendation: {action:'update'|'no_change', proposedParams?, reason}
   * }}
   */
  function run({ candles, strategy, paramGrid, opts = {} } = {}) {
    if (!Array.isArray(candles)) throw new Error('candles required');
    if (!strategy) throw new Error('strategy required');
    const cfg = { ...DEFAULTS, ...opts };
    const scoreFn = typeof opts.scoreFn === 'function' ? opts.scoreFn : _defaultScore;
    const combos = _cartesian(paramGrid);
    if (combos.length === 0) throw new Error('paramGrid produced no combinations');

    const need = cfg.inWindow + cfg.outWindow;
    if (candles.length < need) {
      throw new Error(`need at least ${need} candles (have ${candles.length})`);
    }

    const windows = [];
    for (let start = 0; start + need <= candles.length; start += cfg.step) {
      const inCandles  = candles.slice(start, start + cfg.inWindow);
      const outCandles = candles.slice(start + cfg.inWindow, start + need);

      // Pick best params on IS window
      let bestParams = null;
      let bestScore = -Infinity;
      let bestStats = null;
      for (const params of combos) {
        let res;
        try { res = runBacktest({ candles: inCandles, strategy, params, qty: cfg.qty }); }
        catch { continue; }
        const score = scoreFn(res.stats);
        if (Number.isFinite(score) && score > bestScore) {
          bestScore = score;
          bestParams = params;
          bestStats = res.stats;
        }
      }
      if (!bestParams) continue;

      // Apply to OOS window
      let oosStats = null, oosScore = -Infinity;
      try {
        const oos = runBacktest({ candles: outCandles, strategy, params: bestParams, qty: cfg.qty });
        oosStats = oos.stats;
        oosScore = scoreFn(oosStats);
      } catch { /* tolerated */ }

      windows.push({
        startIdx: start,
        endIdx: start + need - 1,
        isParams: bestParams,
        isScore: Math.round(bestScore * 100) / 100,
        isStats: bestStats,
        oosScore: Number.isFinite(oosScore) ? Math.round(oosScore * 100) / 100 : null,
        oosStats,
      });
    }

    // Aggregate
    const winCount = new Map();
    let oosScoreSum = 0, oosCount = 0;
    let isScoreSum = 0, isCount = 0;
    for (const w of windows) {
      const k = _paramKey(w.isParams);
      winCount.set(k, (winCount.get(k) || 0) + 1);
      if (Number.isFinite(w.oosScore)) { oosScoreSum += w.oosScore; oosCount++; }
      if (Number.isFinite(w.isScore))  { isScoreSum  += w.isScore;  isCount++; }
    }

    // Find dominant param set
    let dominantKey = null, dominantCount = 0;
    for (const [k, c] of winCount.entries()) {
      if (c > dominantCount) { dominantKey = k; dominantCount = c; }
    }
    const dominantParams = dominantKey ? Object.fromEntries(JSON.parse(dominantKey)) : null;
    const dominanceFrac = windows.length > 0 ? dominantCount / windows.length : 0;
    const avgOosScore = oosCount > 0 ? oosScoreSum / oosCount : null;
    const avgIsScore  = isCount  > 0 ? isScoreSum  / isCount  : null;

    let recommendation;
    if (windows.length === 0) {
      recommendation = { action: 'no_change', reason: 'no_valid_windows' };
    } else if (dominanceFrac < cfg.dominanceThreshold) {
      recommendation = {
        action: 'no_change',
        reason: `no dominant param set (best=${dominantKey} won ${dominantCount}/${windows.length}=${(dominanceFrac*100).toFixed(0)}% < ${(cfg.dominanceThreshold*100).toFixed(0)}%)`,
      };
    } else if (avgOosScore == null || avgOosScore <= cfg.minOosPositive) {
      recommendation = {
        action: 'no_change',
        reason: `dominant set has weak OOS (avgOosScore=${avgOosScore} <= ${cfg.minOosPositive})`,
        proposedParams: dominantParams,
      };
    } else {
      recommendation = {
        action: 'update',
        proposedParams: dominantParams,
        reason: `${dominantKey} dominant (${(dominanceFrac*100).toFixed(0)}%) with positive OOS (avg ${avgOosScore.toFixed(2)})`,
      };
    }

    return {
      strategy,
      paramGrid,
      opts: cfg,
      combosTested: combos.length,
      windows,
      summary: {
        windowCount: windows.length,
        avgIsScore:  avgIsScore  != null ? Math.round(avgIsScore  * 100) / 100 : null,
        avgOosScore: avgOosScore != null ? Math.round(avgOosScore * 100) / 100 : null,
        dominantParams,
        dominanceFrac: Math.round(dominanceFrac * 100) / 100,
        overfit: avgIsScore != null && avgOosScore != null && (avgIsScore - avgOosScore) > Math.abs(avgIsScore) * 0.5,
      },
      recommendation,
      asOf: new Date().toISOString(),
    };
  }

  return { run, DEFAULTS };
}

// ---- Smoke tests ----

const SMOKE = () => {
  let pass = 0, fail = 0;
  const check = (lbl, c) => { if (c) { pass++; console.log('  PASS  ' + lbl); } else { fail++; console.log('  FAIL  ' + lbl); } };

  // Synthetic uptrending market with periodic mean-reverting noise
  const candles = [];
  let price = 1000;
  for (let i = 0; i < 200; i++) {
    // Slow drift up + small noise + small mean-revert oscillation
    const drift = 0.3;
    const osc = Math.sin(i / 5) * 4;
    price += drift + osc;
    const day = new Date(2025, 0, 1);
    day.setDate(day.getDate() + i);
    candles.push({
      date: day.toISOString().slice(0,10),
      open: price - 1, high: price + 2, low: price - 2, close: +price.toFixed(2),
    });
  }

  // Mock runBacktest that scores certain param values better than others
  // (so we have a known "winner" for assertion).
  const mockRunBacktest = ({ candles: cs, strategy, params, qty }) => {
    // Synthetic score: prefer rsiPeriod=14, threshold=30 over others
    const fitness = (params.rsiPeriod === 14 ? 50 : 10) + (params.threshold === 30 ? 30 : 5);
    return {
      strategy, params, qty,
      bars: cs.length, trades: [],
      stats: { totalPnl: fitness * cs.length / 100, maxDrawdown: 50, trades: 5, winRate: 60 },
      equity: [],
    };
  };

  const w = createWalkForward({ runBacktest: mockRunBacktest });

  // Test 1: param grid sweep picks the known winner
  const r1 = w.run({
    candles, strategy: 'rsi_mean_revert',
    paramGrid: { rsiPeriod: [10, 14, 20], threshold: [25, 30, 35] },
    opts: { inWindow: 60, outWindow: 14, step: 14, qty: 100 },
  });
  check('returns object with windows', Array.isArray(r1.windows));
  check('windows count > 0', r1.windows.length > 0);
  check('combosTested = 9 (3x3 grid)', r1.combosTested === 9);
  check('dominantParams.rsiPeriod = 14', r1.summary.dominantParams && r1.summary.dominantParams.rsiPeriod === 14);
  check('dominantParams.threshold = 30', r1.summary.dominantParams && r1.summary.dominantParams.threshold === 30);
  check('dominanceFrac > 0.9 (clear winner)', r1.summary.dominanceFrac > 0.9);
  check('recommendation = update', r1.recommendation.action === 'update');
  check('proposedParams match dominant', r1.recommendation.proposedParams.rsiPeriod === 14);

  // Test 2: noisy mock with no clear winner -> no_change
  const noisyRunBacktest = ({ candles: cs, params }) => ({
    strategy: 'x', params, qty: 100, bars: cs.length, trades: [],
    stats: { totalPnl: Math.random() * 100 - 50, maxDrawdown: 30 + Math.random() * 20, trades: 3, winRate: 50 },
    equity: [],
  });
  const w2 = createWalkForward({ runBacktest: noisyRunBacktest });
  const r2 = w2.run({
    candles, strategy: 'noisy',
    paramGrid: { a: [1, 2, 3], b: [10, 20, 30] },
    opts: { inWindow: 60, outWindow: 14, step: 14 },
  });
  check('noisy: dominance probably below threshold OR weak OOS', r2.recommendation.action === 'no_change');

  // Test 3: insufficient candles throws clear error
  let threw = false;
  try { w.run({ candles: candles.slice(0, 10), strategy: 'x', paramGrid: { a: [1] } }); }
  catch (e) { threw = true; check('insufficient candles error message clear', /need at least/.test(e.message)); }
  check('insufficient candles threw', threw);

  // Test 4: empty paramGrid still produces one combination (the empty {})
  const r4 = w.run({
    candles, strategy: 'rsi_mean_revert', paramGrid: {},
    opts: { inWindow: 60, outWindow: 14, step: 14 },
  });
  check('empty grid: combosTested = 1', r4.combosTested === 1);
  check('empty grid: produces windows', r4.windows.length > 0);

  // Test 5: cartesian product correctness
  const w3 = createWalkForward({ runBacktest: mockRunBacktest });
  const r5 = w3.run({
    candles, strategy: 'x',
    paramGrid: { a: [1,2], b: [3,4], c: [5,6,7] },
  });
  check('3-way cartesian: 12 combos', r5.combosTested === 12);

  console.log(`\nSmoke: ${pass} pass, ${fail} fail.`);
  if (fail > 0) process.exit(1);
};

if (require.main === module && process.argv.includes('--smoke')) {
  SMOKE();
}

module.exports = { createWalkForward, DEFAULTS, _cartesian };

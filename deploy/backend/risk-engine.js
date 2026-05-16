// risk-engine.js -- Tier 69a: portfolio risk metrics for the AI/Aladdin features.
//
// Pure function library. No I/O. Caller passes in:
//   - dailyEquity: Array<{ date: string, equity: number }>  (from pnl_daily)
// Returns:
//   - dailyReturns
//   - cumulativeReturn (since first snapshot)
//   - annualizedReturn (CAGR-style from start to end)
//   - volatilityDaily, volatilityAnnual
//   - sharpeRatio (annualized, rfRate default 6.5% Indian risk-free)
//   - sortinoRatio (annualized, downside deviation only)
//   - calmarRatio (annualReturn / |maxDrawdown|)
//   - maxDrawdown (peak-to-trough %, negative)
//   - maxDrawdownDays (duration of worst drawdown)
//   - var95Daily (95% historical VaR, 1-day, as fraction of equity)
//   - var99Daily (99% historical VaR)
//   - var95Parametric (z=1.645 * vol, parametric assuming normal returns)
//   - var99Parametric (z=2.326 * vol)
//   - cvar95Daily (Expected Shortfall = avg of returns below 5th percentile)
//
// All metrics return null when there isn't enough data to compute them
// (need at least 2 daily snapshots for returns, 30 for meaningful Sharpe).

'use strict';

const TRADING_DAYS_PER_YEAR = 252;
const DEFAULT_RF_RATE_ANNUAL = 0.065; // 6.5% Indian 10-year G-Sec proxy

function _clean(rows) {
  if (!Array.isArray(rows)) return [];
  return rows
    .filter(r => r && Number.isFinite(Number(r.equity)) && r.date)
    .map(r => ({ date: r.date, equity: Number(r.equity) }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function _dailyReturns(equity) {
  const ret = [];
  for (let i = 1; i < equity.length; i++) {
    const prev = equity[i - 1].equity;
    const curr = equity[i].equity;
    if (prev > 0) ret.push((curr - prev) / prev);
  }
  return ret;
}

function _mean(arr) {
  if (!arr.length) return 0;
  return arr.reduce((s, x) => s + x, 0) / arr.length;
}

function _stdev(arr, sample = true) {
  if (arr.length < 2) return 0;
  const m = _mean(arr);
  const sumSq = arr.reduce((s, x) => s + (x - m) ** 2, 0);
  return Math.sqrt(sumSq / (arr.length - (sample ? 1 : 0)));
}

function _percentile(sorted, p) {
  if (!sorted.length) return 0;
  const idx = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

function _maxDrawdown(equity) {
  if (equity.length < 2) return { dd: 0, days: 0 };
  let peak = equity[0].equity;
  let peakIdx = 0;
  let maxDD = 0;
  let ddDays = 0;
  for (let i = 1; i < equity.length; i++) {
    const v = equity[i].equity;
    if (v > peak) { peak = v; peakIdx = i; continue; }
    const dd = peak > 0 ? (v - peak) / peak : 0;
    if (dd < maxDD) { maxDD = dd; ddDays = i - peakIdx; }
  }
  return { dd: maxDD, days: ddDays };
}

/**
 * @param {Array<{date:string, equity:number}>} dailyEquity
 * @param {object} [opts]
 * @param {number} [opts.rfAnnual=0.065]  annual risk-free rate
 * @returns {object} risk metrics, with `enoughData` flag
 */
function computeRiskMetrics(dailyEquity, opts = {}) {
  const rfAnnual = Number.isFinite(opts.rfAnnual) ? opts.rfAnnual : DEFAULT_RF_RATE_ANNUAL;
  const rfDaily  = rfAnnual / TRADING_DAYS_PER_YEAR;

  const eq = _clean(dailyEquity);
  if (eq.length < 2) {
    return {
      enoughData: false,
      reason: 'need at least 2 daily snapshots',
      pointCount: eq.length,
    };
  }

  const returns = _dailyReturns(eq);
  if (!returns.length) {
    return { enoughData: false, reason: 'no valid returns from input', pointCount: eq.length };
  }

  const startEq = eq[0].equity;
  const endEq   = eq[eq.length - 1].equity;
  const cumReturn = startEq > 0 ? (endEq - startEq) / startEq : 0;

  const meanReturn = _mean(returns);
  const volDaily   = _stdev(returns);
  const volAnnual  = volDaily * Math.sqrt(TRADING_DAYS_PER_YEAR);

  // Annualized return: prefer geometric (CAGR) when possible, fall back to arithmetic
  const yearsElapsed = returns.length / TRADING_DAYS_PER_YEAR;
  const cagr = (yearsElapsed > 0 && startEq > 0 && endEq > 0)
    ? Math.pow(endEq / startEq, 1 / yearsElapsed) - 1
    : null;
  const annualReturn = cagr != null ? cagr : meanReturn * TRADING_DAYS_PER_YEAR;

  // Sharpe: (annualReturn - rfAnnual) / volAnnual
  const sharpeRatio = volAnnual > 0 ? (annualReturn - rfAnnual) / volAnnual : null;

  // Sortino: like Sharpe but only downside vol
  const downsideReturns = returns.filter(r => r < rfDaily);
  const downsideVolDaily = downsideReturns.length > 1 ? _stdev(downsideReturns) : 0;
  const downsideVolAnnual = downsideVolDaily * Math.sqrt(TRADING_DAYS_PER_YEAR);
  const sortinoRatio = downsideVolAnnual > 0 ? (annualReturn - rfAnnual) / downsideVolAnnual : null;

  // Drawdown
  const { dd: maxDrawdown, days: maxDrawdownDays } = _maxDrawdown(eq);

  // Calmar: annual return / |max drawdown|
  const calmarRatio = (Math.abs(maxDrawdown) > 1e-9) ? annualReturn / Math.abs(maxDrawdown) : null;

  // VaR (1-day): historical at 95% / 99%, parametric for comparison
  const sortedReturns = [...returns].sort((a, b) => a - b);
  const var95Daily = -_percentile(sortedReturns, 5);   // positive number = "expected loss"
  const var99Daily = -_percentile(sortedReturns, 1);
  const var95Parametric = 1.645 * volDaily;
  const var99Parametric = 2.326 * volDaily;

  // CVaR (Expected Shortfall) at 95%: avg of returns in the worst 5%
  const cutoff95 = _percentile(sortedReturns, 5);
  const tailReturns = sortedReturns.filter(r => r <= cutoff95);
  const cvar95Daily = tailReturns.length ? -_mean(tailReturns) : null;

  return {
    enoughData: true,
    pointCount: eq.length,
    returnCount: returns.length,
    yearsElapsed: yearsElapsed,
    cumulativeReturn: cumReturn,
    annualizedReturn: annualReturn,
    volatilityDaily: volDaily,
    volatilityAnnual: volAnnual,
    sharpeRatio,
    sortinoRatio,
    calmarRatio,
    maxDrawdown,
    maxDrawdownDays,
    var95Daily,
    var99Daily,
    var95Parametric,
    var99Parametric,
    cvar95Daily,
    // Echo inputs for transparency
    rfAnnualUsed: rfAnnual,
    startDate: eq[0].date,
    endDate: eq[eq.length - 1].date,
    startEquity: startEq,
    endEquity: endEq,
  };
}

module.exports = {
  computeRiskMetrics,
  // Exported for unit tests
  _internal: { _clean, _dailyReturns, _mean, _stdev, _percentile, _maxDrawdown },
};

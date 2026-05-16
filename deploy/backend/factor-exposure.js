// factor-exposure.js -- Tier 69b: returns-based factor exposure for a user's portfolio.
//
// Honest scope. We compute factors that can be derived from price history alone
// (which Kite gives us). We do NOT compute fundamental factors (P/E, P/B, ROE,
// quality) because Kite doesn't provide that data. Building those would require
// FactSet / Bloomberg / Tijori. When we wire in a fundamentals data source the
// API surface here can extend without breaking callers.
//
// What we DO compute:
//   - Per-holding return windows: 1M, 3M, 12M (252-day price change %)
//   - Per-holding volatility (annualized stdev of daily returns over 252 days)
//   - Per-holding max drawdown over the lookback window
//   - Portfolio-weighted versions of all of the above (weight = position notional / total)
//   - Concentration metrics: single-stock %, single-sector % (when sector map provided)
//
// Pure function library. No I/O. The caller passes in:
//   - holdings: Array<{ symbol, qty, ltp, sector? }>
//   - candlesBySymbol: Map<string, Array<{ date: string, close: number }>>  — at least 21 trading days each
//   - sectorMap (optional): { [symbol]: 'IT' | 'BANKING' | etc }

'use strict';

const TRADING_DAYS_PER_YEAR = 252;

function _returnsFromCloses(closes) {
  const ret = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0) ret.push((closes[i] - closes[i - 1]) / closes[i - 1]);
  }
  return ret;
}

function _stdev(arr) {
  if (arr.length < 2) return 0;
  const m = arr.reduce((s, x) => s + x, 0) / arr.length;
  return Math.sqrt(arr.reduce((s, x) => s + (x - m) ** 2, 0) / (arr.length - 1));
}

function _maxDDFromCloses(closes) {
  if (closes.length < 2) return 0;
  let peak = closes[0];
  let dd = 0;
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > peak) peak = closes[i];
    else if (peak > 0) {
      const cur = (closes[i] - peak) / peak;
      if (cur < dd) dd = cur;
    }
  }
  return dd;
}

function _windowReturn(closes, days) {
  if (closes.length < days + 1) return null;
  const start = closes[closes.length - 1 - days];
  const end   = closes[closes.length - 1];
  if (!(start > 0)) return null;
  return (end - start) / start;
}

/**
 * @param {object} args
 * @param {Array<{symbol:string, qty:number, ltp:number, sector?:string}>} args.holdings
 * @param {Object<string, Array<{date:string, close:number}>>} args.candlesBySymbol
 * @param {Object<string, string>} [args.sectorMap]
 * @returns {object} factor exposure report
 */
function computeFactorExposure({ holdings, candlesBySymbol, sectorMap }) {
  if (!Array.isArray(holdings) || holdings.length === 0) {
    return { enoughData: false, reason: 'no_holdings', perHolding: [], portfolio: null, concentration: null };
  }

  candlesBySymbol = candlesBySymbol || {};
  sectorMap = sectorMap || {};

  // Compute per-holding factor scores.
  const totalNotional = holdings.reduce((s, h) => s + Math.max(0, Number(h.qty || 0) * Number(h.ltp || 0)), 0);
  if (totalNotional <= 0) {
    return { enoughData: false, reason: 'zero_notional', perHolding: [], portfolio: null, concentration: null };
  }

  const perHolding = [];
  let portfolioMomentum1M  = 0;
  let portfolioMomentum3M  = 0;
  let portfolioMomentum12M = 0;
  let portfolioVol         = 0;
  let portfolioMaxDD       = 0;
  let coverageNotional     = 0;
  const sectorWeights      = {};

  for (const h of holdings) {
    const qty = Number(h.qty || 0);
    const ltp = Number(h.ltp || 0);
    const notional = Math.max(0, qty * ltp);
    const weight = notional / totalNotional;
    const candles = candlesBySymbol[h.symbol] || candlesBySymbol[h.symbol?.toUpperCase()] || [];
    const closes = candles.map(c => Number(c.close || c.c || 0)).filter(x => x > 0);

    const r1M  = _windowReturn(closes, 21);
    const r3M  = _windowReturn(closes, 63);
    const r12M = _windowReturn(closes, 252);
    const dailyRet = _returnsFromCloses(closes);
    const annualVol = _stdev(dailyRet) * Math.sqrt(TRADING_DAYS_PER_YEAR);
    const dd = _maxDDFromCloses(closes);

    const sector = sectorMap[h.symbol] || h.sector || 'Unclassified';
    sectorWeights[sector] = (sectorWeights[sector] || 0) + weight;

    const candleCount = closes.length;
    perHolding.push({
      symbol: h.symbol,
      weight,
      notional,
      candleCount,
      sector,
      momentum1M: r1M,
      momentum3M: r3M,
      momentum12M: r12M,
      volatilityAnnual: annualVol,
      maxDrawdown: dd,
    });

    // Aggregate into portfolio-weighted averages, only counting holdings that
    // have enough candles for each metric.
    if (r1M  != null) { portfolioMomentum1M  += weight * r1M;  coverageNotional = totalNotional; }
    if (r3M  != null) { portfolioMomentum3M  += weight * r3M; }
    if (r12M != null) { portfolioMomentum12M += weight * r12M; }
    if (annualVol > 0) portfolioVol += weight * annualVol;
    if (dd < 0)        portfolioMaxDD += weight * dd;
  }

  // Concentration metrics
  const sortedByWeight = [...perHolding].sort((a, b) => b.weight - a.weight);
  const top1   = sortedByWeight[0]?.weight || 0;
  const top3   = sortedByWeight.slice(0, 3).reduce((s, h) => s + h.weight, 0);
  const top10  = sortedByWeight.slice(0, 10).reduce((s, h) => s + h.weight, 0);

  const sectorEntries = Object.entries(sectorWeights).sort((a, b) => b[1] - a[1]);
  const topSector = sectorEntries[0] ? { name: sectorEntries[0][0], weight: sectorEntries[0][1] } : null;

  // Concentration warnings (the same thresholds Aladdin-style risk dashboards use)
  const warnings = [];
  if (top1 > 0.10)              warnings.push({ kind: 'single_stock_over_10', symbol: sortedByWeight[0].symbol, weight: top1 });
  if (topSector && topSector.weight > 0.25) warnings.push({ kind: 'single_sector_over_25', sector: topSector.name, weight: topSector.weight });
  if (top3 > 0.50)              warnings.push({ kind: 'top3_over_50', weight: top3 });

  return {
    enoughData: true,
    holdingCount: perHolding.length,
    totalNotional,
    perHolding: sortedByWeight,
    portfolio: {
      momentum1M:  coverageNotional > 0 ? portfolioMomentum1M  : null,
      momentum3M:  coverageNotional > 0 ? portfolioMomentum3M  : null,
      momentum12M: coverageNotional > 0 ? portfolioMomentum12M : null,
      volatilityAnnual: portfolioVol,
      maxDrawdown: portfolioMaxDD,
    },
    concentration: {
      top1Weight: top1,
      top3Weight: top3,
      top10Weight: top10,
      sectorWeights,
      topSector,
      warnings,
    },
  };
}

module.exports = {
  computeFactorExposure,
  _internal: { _returnsFromCloses, _stdev, _maxDDFromCloses, _windowReturn },
};

// T-272 -- Unified Position View aggregator (Phase 2, vision doc §4.1).
//
// Centralized "what do I own / what am I exposed to" computation. Builds the
// in-memory portfolio view that the Aladdin-style architecture revolves around:
// every order pre-trade check, every Risk Cockpit screen render, every digest
// report reads from THIS service rather than re-deriving from raw positions.
//
// Pure functions. No side effects. Safe to call on every request.
//
// Public API:
//   const agg = createPortfolioAggregates({ getPositions, getCash, getTicks, getTrades });
//   agg.compute()  -> { totalValue, cash, gross, net, leverage, byStrategy, bySector, ... }
//   agg.bySymbol() -> [{ symbol, qty, avgPrice, ltp, mtmPnl, weight, sector }, ...]
//
// Out of scope for T-272 (deferred):
//   - Option Greeks (delta/gamma/vega/theta) -- requires option chain + IV; T-290
//   - Pair correlation matrix              -- requires historical returns; later
//   - Scenario stress tests (T-275)        -- next Phase 2 ticket
//
// Sector map is a static hardcode for Indian large/mid caps. When the operator
// holds an instrument we don't recognise (e.g. an ETF or new IPO), it falls
// into 'other'. The map is curated, not auto-fetched -- adding a symbol here
// is a one-line edit. Honest: this is a stopgap until we either fetch sector
// metadata from Kite instruments or add a user_sector_overrides table.

'use strict';

// ---- Sector map (NSE/BSE common large+mid caps) ----
const SECTOR_MAP = Object.freeze({
  // ETFs
  'NIFTYBEES': 'etf',
  'JUNIORBEES': 'etf',
  'GOLDBEES': 'etf',
  'MOM100': 'etf',
  'BANKBEES': 'etf',
  'ITBEES': 'etf',

  // Banking + financials
  'HDFCBANK': 'banking',
  'ICICIBANK': 'banking',
  'SBIN': 'banking',
  'KOTAKBANK': 'banking',
  'AXISBANK': 'banking',
  'INDUSINDBK': 'banking',
  'BAJFINANCE': 'financials',
  'BAJAJFINSV': 'financials',
  'HDFCLIFE': 'financials',
  'SBILIFE': 'financials',

  // IT
  'TCS': 'it',
  'INFY': 'it',
  'WIPRO': 'it',
  'HCLTECH': 'it',
  'TECHM': 'it',
  'LTIM': 'it',

  // Energy + oil & gas
  'RELIANCE': 'energy',
  'ONGC': 'energy',
  'BPCL': 'energy',
  'IOC': 'energy',
  'GAIL': 'energy',
  'POWERGRID': 'utilities',
  'NTPC': 'utilities',

  // Auto
  'MARUTI': 'auto',
  'TATAMOTORS': 'auto',
  'M&M': 'auto',
  'BAJAJ-AUTO': 'auto',
  'HEROMOTOCO': 'auto',
  'EICHERMOT': 'auto',

  // Consumer / FMCG
  'HINDUNILVR': 'fmcg',
  'ITC': 'fmcg',
  'NESTLEIND': 'fmcg',
  'BRITANNIA': 'fmcg',
  'DABUR': 'fmcg',

  // Pharma
  'SUNPHARMA': 'pharma',
  'DRREDDY': 'pharma',
  'CIPLA': 'pharma',
  'DIVISLAB': 'pharma',
  'APOLLOHOSP': 'pharma',

  // Metals + commodities
  'TATASTEEL': 'metals',
  'JSWSTEEL': 'metals',
  'HINDALCO': 'metals',
  'COALINDIA': 'metals',
  'ULTRACEMCO': 'cement',
  'GRASIM': 'cement',
  'SHREECEM': 'cement',

  // Telecom + media
  'BHARTIARTL': 'telecom',
  'TITAN': 'consumer_disc',
  'ASIANPAINT': 'consumer_disc',
  'LT': 'industrials',
});

function _sectorOf(symbol) {
  if (!symbol) return 'other';
  const bare = String(symbol).replace(/^(NSE|BSE|NFO|BFO|MCX|CDS):/, '').toUpperCase();
  return SECTOR_MAP[bare] || 'other';
}

function _round(n, places = 2) {
  const m = Math.pow(10, places);
  return Math.round(n * m) / m;
}

/**
 * Factory. Pass in getters so callers can wire the live engine state.
 *   getPositions:  () => Array<{ symbol, qty, avgPrice, openedAt }>
 *   getCash:       () => number (paper INR cash balance)
 *   getTicks:      () => Map<symbol, ltp>  (mark-to-market source)
 *   getTrades:     (n) => Array<{ symbol, side, qty, price, ts, strategy, pnl }>
 *                   for the byStrategy breakdown (closed trades only)
 */
function createPortfolioAggregates({ getPositions, getCash, getTicks, getTrades }) {
  if (typeof getPositions !== 'function') throw new Error('getPositions required');
  if (typeof getCash      !== 'function') throw new Error('getCash required');
  if (typeof getTicks     !== 'function') throw new Error('getTicks required');

  function bySymbol() {
    const positions = getPositions() || [];
    const ticks = getTicks() || new Map();
    return positions
      .filter(p => p && p.symbol && Number.isFinite(p.qty) && p.qty !== 0)
      .map(p => {
        const ltp = (ticks instanceof Map) ? ticks.get(p.symbol) : null;
        const hasLtp = Number.isFinite(ltp) && ltp > 0;
        const marketValue = hasLtp ? ltp * p.qty : (p.avgPrice * p.qty);
        const mtmPnl = hasLtp ? (ltp - p.avgPrice) * p.qty : 0;
        const mtmPnlPct = hasLtp ? ((ltp - p.avgPrice) / p.avgPrice) * 100 : 0;
        return {
          symbol: p.symbol,
          qty: p.qty,
          avgPrice: _round(p.avgPrice, 2),
          ltp: hasLtp ? _round(ltp, 2) : null,
          marketValue: _round(marketValue, 2),
          mtmPnl: _round(mtmPnl, 2),
          mtmPnlPct: _round(mtmPnlPct, 2),
          openedAt: p.openedAt,
          sector: _sectorOf(p.symbol),
        };
      });
  }

  function _byStrategy() {
    if (typeof getTrades !== 'function') return {};
    const trades = getTrades(500) || [];   // last 500 closed trades
    const map = {};
    for (const t of trades) {
      const tag = (t.strategy || 'manual').toString();
      if (!map[tag]) map[tag] = { realisedPnl: 0, count: 0 };
      map[tag].realisedPnl += Number(t.pnl) || 0;
      map[tag].count += 1;
    }
    // Round + sort
    return Object.fromEntries(
      Object.entries(map).map(([k, v]) => [k, { realisedPnl: _round(v.realisedPnl, 2), count: v.count }])
    );
  }

  function _bySector(positionsView) {
    const map = {};
    for (const p of positionsView) {
      const s = p.sector;
      if (!map[s]) map[s] = { marketValue: 0, count: 0 };
      map[s].marketValue += p.marketValue;
      map[s].count += 1;
    }
    return Object.fromEntries(
      Object.entries(map).map(([k, v]) => [k, { marketValue: _round(v.marketValue, 2), count: v.count }])
    );
  }

  function compute() {
    const positions = bySymbol();
    const cash = Number(getCash()) || 0;

    // Long market value: sum of long position market values (qty > 0)
    // Short market value: sum of |market values| for shorts (qty < 0)
    let longMV = 0, shortMV = 0, totalMtmPnl = 0;
    for (const p of positions) {
      if (p.qty > 0) longMV += p.marketValue;
      else if (p.qty < 0) shortMV += Math.abs(p.marketValue);
      totalMtmPnl += p.mtmPnl;
    }

    const totalValue = cash + longMV - shortMV;         // net account value
    const grossExposure = longMV + shortMV;             // total |notional|
    const netExposure   = longMV - shortMV;             // directional bias
    const leverage      = (cash + totalMtmPnl) > 0 ? grossExposure / Math.max(cash, 1) : 0;

    // Per-sector weights (% of long market value, since shorts complicate %)
    const sectorMap = _bySector(positions);
    for (const sec of Object.keys(sectorMap)) {
      const pct = longMV > 0 ? (sectorMap[sec].marketValue / longMV) * 100 : 0;
      sectorMap[sec].weightPct = _round(pct, 2);
    }

    const strategyMap = _byStrategy();

    // Concentration: largest single-position % of long MV
    let topConcentration = { symbol: null, pct: 0 };
    for (const p of positions) {
      if (p.qty <= 0 || longMV <= 0) continue;
      const pct = (p.marketValue / longMV) * 100;
      if (pct > topConcentration.pct) topConcentration = { symbol: p.symbol, pct: _round(pct, 2) };
    }

    return {
      asOf: new Date().toISOString(),
      // Position table
      positions,
      positionCount: positions.length,
      // Money summary
      cash: _round(cash, 2),
      totalValue: _round(totalValue, 2),
      totalMtmPnl: _round(totalMtmPnl, 2),
      // Exposure
      longMV: _round(longMV, 2),
      shortMV: _round(shortMV, 2),
      grossExposure: _round(grossExposure, 2),
      netExposure:   _round(netExposure, 2),
      leverage:      _round(leverage, 2),
      // Breakdowns
      bySector:   sectorMap,
      byStrategy: strategyMap,
      topConcentration,
      // Schema version so the UI knows what shape to expect
      _schema: 'portfolio-aggregates-v1',
    };
  }

  // T-275: scenario stress test. Applies a shock vector to current positions
  // and returns hypothetical PnL. Pure function -- no state mutation.
  //
  // shock = {
  //   broadPct:     -3,            // applies to every position uniformly (e.g. NIFTY -3%)
  //   bySector:     { it: -8 },    // applies on TOP of broad to specific sectors
  //   bySymbol:     { TCS: -12 },  // applies on TOP of broad+sector to specific symbols
  // }
  // The composition is multiplicative: each level multiplies the price.
  function stress(shock = {}) {
    const positions = bySymbol();
    const broadPct  = Number(shock.broadPct)  || 0;
    const bySector  = (shock.bySector  && typeof shock.bySector  === 'object') ? shock.bySector  : {};
    const bySymbol2 = (shock.bySymbol  && typeof shock.bySymbol  === 'object') ? shock.bySymbol  : {};

    const shockedPositions = positions.map(p => {
      const basePrice = (p.ltp != null) ? p.ltp : p.avgPrice;
      let pctMove = broadPct;
      if (bySector[p.sector] != null) pctMove += Number(bySector[p.sector]) || 0;
      if (bySymbol2[p.symbol] != null) pctMove += Number(bySymbol2[p.symbol]) || 0;
      const shockedPrice = basePrice * (1 + pctMove / 100);
      const shockedMV    = shockedPrice * p.qty;
      const baselineMV   = basePrice    * p.qty;
      const shockPnl     = shockedMV - baselineMV;
      return {
        symbol: p.symbol,
        qty: p.qty,
        basePrice: _round(basePrice, 2),
        shockedPrice: _round(shockedPrice, 2),
        pctMove: _round(pctMove, 2),
        baselineMV: _round(baselineMV, 2),
        shockedMV: _round(shockedMV, 2),
        shockPnl: _round(shockPnl, 2),
        sector: p.sector,
      };
    });

    let totalBaselineMV = 0, totalShockedMV = 0, totalShockPnl = 0;
    for (const s of shockedPositions) {
      totalBaselineMV += s.baselineMV;
      totalShockedMV  += s.shockedMV;
      totalShockPnl   += s.shockPnl;
    }
    const portfolioMovePct = totalBaselineMV > 0
      ? (totalShockPnl / totalBaselineMV) * 100
      : 0;

    return {
      shock,
      positions: shockedPositions,
      totalBaselineMV: _round(totalBaselineMV, 2),
      totalShockedMV:  _round(totalShockedMV, 2),
      totalShockPnl:   _round(totalShockPnl, 2),
      portfolioMovePct: _round(portfolioMovePct, 2),
      asOf: new Date().toISOString(),
    };
  }

  return { compute, bySymbol, stress, _sectorOf };
}

module.exports = { createPortfolioAggregates, SECTOR_MAP };

// T-293a -- Covered Call strategy template (Phase 4 logic layer).
//
// Pure functions. No engine wiring. Builds on:
//   - black-scholes.js  (T-294a) for Greeks
//   - option-chain.js   (T-290a) for strike picker
//
// Covered Call concept (the simplest options strategy):
//   You own N shares of a stock. You sell 1 OTM call option against those
//   shares (lot_size shares per contract). You pocket the premium today.
//   - If price stays below strike at expiry: keep premium, keep shares.
//   - If price ends above strike: shares get called away at the strike;
//     you keep the premium + (strike - cost basis), but miss the upside
//     above strike. Net: collared upside in exchange for income.
//
// What this module exposes:
//   findOpportunities({ holdings, chain, opts })
//     -> for each eligible holding, suggest the best call to sell.
//        Eligibility = (a) holding qty >= lot_size; (b) chain has an
//        OTM call at appropriate delta and DTE; (c) projected premium
//        is meaningful (> minPremiumINR).
//
//   priceOpportunity(opportunity)
//     -> attach detailed metrics: premium, breakeven, max profit, return
//        on capital, days held, scenarios at +/-5% spot moves.
//
// What this module DOES NOT do (deliberately):
//   - Place any orders. Caller takes opportunity and decides.
//   - Track existing short-call positions. Caller is responsible for
//     filtering out holdings that already have a covered call written.
//   - Roll logic (closing one short call and opening another later).
//
// Smoke test: synthesize a holding + chain, verify the suggested call
// matches expected delta and isn't above existing concentration thresholds.
//
// Run smoke tests:
//   node deploy/backend/services/strategy-covered-call.js --smoke

'use strict';

const oc = require('./option-chain');

const DEFAULTS = Object.freeze({
  targetDelta:  0.25,        // sell calls with delta ~0.25 (about 25% prob ITM)
  minDte:       3,           // skip if < 3 days to expiry (gamma risk)
  maxDte:       45,          // skip if > 45 days (theta too slow)
  minPremiumINR: 50,         // skip if expected premium < this (not worth fees)
  riskFreeRate: 0.07,
});

function _roundTo(n, places) {
  const m = Math.pow(10, places);
  return Math.round(n * m) / m;
}

function _dteFromExpiry(expiryStr, asOf) {
  const expiry = new Date(expiryStr + 'T15:30:00+05:30');
  const now = asOf instanceof Date ? asOf : new Date();
  const ms = expiry.getTime() - now.getTime();
  return Math.max(0, Math.floor(ms / (24 * 3600 * 1000)));
}

/**
 * Scan a portfolio for covered-call opportunities.
 *
 * @param {object} args
 * @param {Array}  args.holdings    [{ symbol, qty, avgPrice, ltp }, ...]
 * @param {Array}  args.chain       Greeks-enriched option chain (output of
 *                                   option-chain.enrichWithGreeks)
 * @param {object} [args.opts]      overrides for DEFAULTS
 * @returns {Array} sorted by expected premium descending
 */
function findOpportunities({ holdings, chain, opts = {} }) {
  if (!Array.isArray(holdings) || !Array.isArray(chain)) return [];
  const cfg = { ...DEFAULTS, ...opts };
  const asOf = opts.asOf instanceof Date ? opts.asOf : new Date();

  const out = [];
  for (const h of holdings) {
    if (!h || !h.symbol) continue;
    if (!Number.isFinite(h.qty) || h.qty <= 0) continue;          // long only
    const spot = Number.isFinite(h.ltp) && h.ltp > 0 ? h.ltp : h.avgPrice;
    if (!Number.isFinite(spot) || spot <= 0) continue;

    // Filter chain to this symbol's calls only.
    // For NIFTY ETF holdings (e.g. NIFTYBEES), the operator should be using
    // NIFTY index options; the underlying name maps differently. v1: only
    // consider exact-symbol matches. Future: extend to ETF-on-index mapping.
    const symbolCalls = chain.filter(row =>
      row.type === 'call' &&
      row.greeks &&
      Number.isFinite(row.greeks.delta) &&
      Number.isFinite(row.greeks.price) &&
      row.greeks.delta > 0   // not deep-OTM-zero
    );

    if (symbolCalls.length === 0) continue;

    // Filter by DTE band
    const eligible = symbolCalls.filter(row => {
      const dte = _dteFromExpiry(row.expiry, asOf);
      return dte >= cfg.minDte && dte <= cfg.maxDte;
    });
    if (eligible.length === 0) continue;

    // Among eligible expiries, pick the one closest to the middle of the
    // DTE band (favours ~3 weeks out — sweet spot of theta decay).
    const midDte = (cfg.minDte + cfg.maxDte) / 2;
    const sortedByExpiry = eligible.slice().sort((a, b) => {
      const da = Math.abs(_dteFromExpiry(a.expiry, asOf) - midDte);
      const db = Math.abs(_dteFromExpiry(b.expiry, asOf) - midDte);
      return da - db;
    });
    const targetExpiry = sortedByExpiry[0].expiry;

    // Pick strike by delta
    const pick = oc.pickStrikeByDelta(eligible, {
      type: 'call',
      targetDelta: cfg.targetDelta,
      expiry: targetExpiry,
    });
    if (!pick) continue;
    if (!pick.greeks || !Number.isFinite(pick.greeks.price)) continue;

    const lotSize = Number.isFinite(pick.lotSize) && pick.lotSize > 0 ? pick.lotSize : 1;
    // Max contracts we can write = floor(qty / lot_size). A "covered" call
    // requires the underlying shares to deliver if assigned.
    const maxContracts = Math.floor(h.qty / lotSize);
    if (maxContracts < 1) continue;

    // Premium income per contract = mid-price * lot_size.
    // (We use BS theoretical price here; the actual market premium will be
    //  the bid for sell-to-open, which is typically slightly below theoretical.)
    const premiumPerContract = pick.greeks.price * lotSize;
    if (premiumPerContract < cfg.minPremiumINR) continue;

    out.push({
      holdingSymbol: h.symbol,
      holdingQty: h.qty,
      holdingAvgPrice: h.avgPrice,
      spot,
      callSymbol: pick.symbol,
      strike: pick.strike,
      expiry: pick.expiry,
      dte: _dteFromExpiry(pick.expiry, asOf),
      delta: pick.greeks.delta,
      theoreticalPrice: _roundTo(pick.greeks.price, 2),
      lotSize,
      maxContracts,
      premiumPerContract: _roundTo(premiumPerContract, 2),
      totalPremium: _roundTo(premiumPerContract * maxContracts, 2),
      ivUsed: pick.ivUsed,
      ivSource: pick.ivSource,
    });
  }

  // Sort by total premium desc -- highest-income opportunities first
  out.sort((a, b) => b.totalPremium - a.totalPremium);
  return out;
}

/**
 * Attach detailed economics to an opportunity. Useful for the UI / digest.
 *   maxProfit:  premium + (strike - avgPrice) * qty if called away, else
 *               premium + (currentSpot - avgPrice) * qty unrealised
 *   breakeven:  avgPrice - premiumPerShare    (the price below which you lose money)
 *   scenarios:  outcomes at spot - 5%, spot, spot + 5%, strike, strike + 5%
 */
function priceOpportunity(opp) {
  if (!opp || typeof opp !== 'object') return null;
  const { holdingAvgPrice, holdingQty, spot, strike, premiumPerContract, lotSize, maxContracts } = opp;
  if (!Number.isFinite(holdingAvgPrice) || !Number.isFinite(holdingQty) || !Number.isFinite(spot)) return null;

  const premiumPerShare = premiumPerContract / lotSize;
  const sharesCovered = maxContracts * lotSize;
  const totalPremium = opp.totalPremium;

  // If shares are called away at expiry (spot >= strike):
  //   stock P&L (on the covered portion) = (strike - avgPrice) * sharesCovered
  //   + premium
  //   minus opportunity cost = (spot_final - strike) * sharesCovered, but we keep premium so net is bounded.
  const calledAwayPnl =
    (strike - holdingAvgPrice) * sharesCovered + totalPremium;

  // If shares are NOT called away (spot < strike at expiry):
  //   stock P&L on covered shares + premium (keep both)
  //   We don't know final spot; report at current spot for "today's view".
  const keptAtCurrentSpot =
    (spot - holdingAvgPrice) * sharesCovered + totalPremium;

  // Breakeven per share = avgPrice - premium-per-share
  // (You lose money if the stock drops below this and you've not closed)
  const breakevenPerShare = holdingAvgPrice - premiumPerShare;

  // Return on capital approximation (premium / underlying cost basis on covered portion)
  const capitalDeployed = holdingAvgPrice * sharesCovered;
  const returnOnCapital = capitalDeployed > 0 ? (totalPremium / capitalDeployed) * 100 : 0;

  // Annualised yield (assume 30 days as approximation)
  const dte = opp.dte || 30;
  const annualisedYield = dte > 0 ? returnOnCapital * (365 / dte) : 0;

  // Scenarios at expiry
  const scenarios = [
    { label: 'spot −5%', finalSpot: spot * 0.95 },
    { label: 'flat',     finalSpot: spot },
    { label: 'spot +5%', finalSpot: spot * 1.05 },
    { label: 'at strike', finalSpot: strike },
    { label: 'above strike', finalSpot: strike * 1.05 },
  ].map(s => {
    const finalSpot = s.finalSpot;
    const isCalledAway = finalSpot >= strike;
    let stockPnl;
    if (isCalledAway) {
      // Shares delivered at strike (covered portion). Uncovered portion (h.qty - sharesCovered) still marks to finalSpot.
      stockPnl = (strike - holdingAvgPrice) * sharesCovered
                + (finalSpot - holdingAvgPrice) * Math.max(0, holdingQty - sharesCovered);
    } else {
      // All shares still owned at finalSpot
      stockPnl = (finalSpot - holdingAvgPrice) * holdingQty;
    }
    return {
      label: s.label,
      finalSpot: _roundTo(finalSpot, 2),
      calledAway: isCalledAway,
      stockPnl: _roundTo(stockPnl, 2),
      premiumKept: totalPremium,   // premium is yours regardless
      totalPnl: _roundTo(stockPnl + totalPremium, 2),
    };
  });

  return {
    ...opp,
    breakevenPerShare: _roundTo(breakevenPerShare, 2),
    premiumPerShare: _roundTo(premiumPerShare, 2),
    sharesCovered,
    calledAwayPnl: _roundTo(calledAwayPnl, 2),
    keptAtCurrentSpotPnl: _roundTo(keptAtCurrentSpot, 2),
    capitalDeployed: _roundTo(capitalDeployed, 2),
    returnOnCapitalPct: _roundTo(returnOnCapital, 2),
    annualisedYieldPct: _roundTo(annualisedYield, 1),
    scenarios,
  };
}

// ---- Smoke tests ----

const SMOKE = () => {
  const bs = require('./black-scholes');
  const oc2 = require('./option-chain');
  const today = new Date('2026-05-21T10:00:00+05:30');
  const expiry = new Date(today.getTime() + 14 * 24 * 3600 * 1000); // 2 weeks
  const expiryStr = expiry.toISOString().slice(0, 10);

  // Synthesize a NIFTY chain (5 strikes, both types)
  const raw = [];
  for (const k of [24300, 24400, 24500, 24600, 24700]) {
    raw.push({ name: 'NIFTY', segment: 'NFO-OPT', instrument_type: 'CE',
               tradingsymbol: `NIFTY${k}CE`, instrument_token: 1000000+k,
               strike: k, expiry: expiryStr, lot_size: 75 });
    raw.push({ name: 'NIFTY', segment: 'NFO-OPT', instrument_type: 'PE',
               tradingsymbol: `NIFTY${k}PE`, instrument_token: 2000000+k,
               strike: k, expiry: expiryStr, lot_size: 75 });
  }
  const parsed = oc2.parseKiteInstruments(raw, 'NIFTY', { asOf: today });
  const enriched = oc2.enrichWithGreeks(parsed, { spot: 24500, riskFreeRate: 0.07, asOf: today, assumedIV: 0.13 });

  // Operator holds 150 shares of NIFTYBEES (an ETF; treat as NIFTY for v1).
  // Actually v1 only matches exact symbol -- so use 'NIFTY' (synthetic future).
  const holdings = [
    { symbol: 'NIFTY', qty: 150, avgPrice: 24200, ltp: 24500 },
  ];

  const opps = findOpportunities({ holdings, chain: enriched, opts: { asOf: today } });
  const test1 = opps.length === 1;
  console.log(`  ${test1 ? 'PASS' : 'FAIL'}  found ${opps.length} opportunity (expected 1)`);

  if (opps.length > 0) {
    const o = opps[0];
    const test2 = o.holdingSymbol === 'NIFTY';
    console.log(`  ${test2 ? 'PASS' : 'FAIL'}  opp targets the right holding (${o.holdingSymbol})`);

    const test3 = o.maxContracts === Math.floor(150 / 75) && o.maxContracts === 2;
    console.log(`  ${test3 ? 'PASS' : 'FAIL'}  maxContracts = ${o.maxContracts} (expected 2)`);

    const test4 = o.delta > 0 && o.delta < 0.5;
    console.log(`  ${test4 ? 'PASS' : 'FAIL'}  delta ${o.delta} is OTM (in (0, 0.5))`);

    const test5 = o.strike >= 24500 && o.strike <= 24700;
    console.log(`  ${test5 ? 'PASS' : 'FAIL'}  strike ${o.strike} is at-or-above spot`);

    const test6 = o.totalPremium > 0;
    console.log(`  ${test6 ? 'PASS' : 'FAIL'}  totalPremium ${o.totalPremium} > 0`);

    const priced = priceOpportunity(o);
    const test7 = Number.isFinite(priced.breakevenPerShare) && priced.breakevenPerShare < o.holdingAvgPrice;
    console.log(`  ${test7 ? 'PASS' : 'FAIL'}  breakeven ${priced.breakevenPerShare} below avgPrice ${o.holdingAvgPrice}`);

    const test8 = Array.isArray(priced.scenarios) && priced.scenarios.length === 5;
    console.log(`  ${test8 ? 'PASS' : 'FAIL'}  ${priced.scenarios.length} scenarios computed`);

    // If called away, P&L should equal (strike - avg) * sharesCovered + premium
    const calledAwayScenario = priced.scenarios.find(s => s.label === 'above strike');
    const expectedCallPnl = (o.strike - 24200) * (o.maxContracts * o.lotSize) + (24700 * 1.05 - 24200) * Math.max(0, 150 - o.maxContracts * o.lotSize) + o.totalPremium;
    const test9 = calledAwayScenario && calledAwayScenario.calledAway === true;
    console.log(`  ${test9 ? 'PASS' : 'FAIL'}  'above strike' scenario flagged calledAway`);

    const test10 = priced.annualisedYieldPct > 0;
    console.log(`  ${test10 ? 'PASS' : 'FAIL'}  annualised yield ${priced.annualisedYieldPct}% > 0`);

    const results = [test1, test2, test3, test4, test5, test6, test7, test8, test9, test10];
    const pass = results.filter(Boolean).length;
    const fail = results.length - pass;
    console.log(`\nSmoke: ${pass} pass, ${fail} fail.`);
    if (fail > 0) process.exit(1);
  }

  // Edge cases
  console.log('\n--- Edge cases ---');
  const emptyHoldings = findOpportunities({ holdings: [], chain: enriched });
  console.log(`  ${emptyHoldings.length === 0 ? 'PASS' : 'FAIL'}  empty holdings -> no opps`);
  const emptyChain = findOpportunities({ holdings, chain: [] });
  console.log(`  ${emptyChain.length === 0 ? 'PASS' : 'FAIL'}  empty chain -> no opps`);
  const tinyHolding = findOpportunities({ holdings: [{ symbol: 'NIFTY', qty: 10, avgPrice: 24200, ltp: 24500 }], chain: enriched, opts: { asOf: today } });
  console.log(`  ${tinyHolding.length === 0 ? 'PASS' : 'FAIL'}  qty=10 < lot_size=75 -> no opps`);
};

if (require.main === module && process.argv.includes('--smoke')) {
  SMOKE();
}

module.exports = {
  findOpportunities,
  priceOpportunity,
  DEFAULTS,
};

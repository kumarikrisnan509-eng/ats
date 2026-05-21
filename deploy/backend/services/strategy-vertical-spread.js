// T-292a -- Vertical spread strategy templates (Phase 4 logic layer).
//
// Pure functions. Two directional defined-risk structures:
//
//   Bull Call Spread    bullish view; defined max-loss
//     BUY  call at lower strike (higher delta, e.g. 0.50)
//     SELL call at higher strike (lower delta, e.g. 0.30)
//     Max loss = net debit; Max profit = (Kh - Kl) * lot - net debit
//
//   Bear Put Spread     bearish view; defined max-loss
//     BUY  put at higher strike (more negative delta, e.g. -0.50)
//     SELL put at lower strike (less negative delta, e.g. -0.30)
//     Max loss = net debit; Max profit = (Kh - Kl) * lot - net debit
//
// Both are NET DEBIT spreads (pay premium up front). Caller wires them
// into paper.js / live broker as TWO simultaneous orders. Multi-leg
// atomic execution is a separate concern (T-291 dependency).
//
// Public API:
//   findBullCallSpread({ chain, opts })     -> opportunity | null
//   findBearPutSpread({ chain, opts })      -> opportunity | null
//   priceSpread(opp)                         -> opp + max/min P&L scenarios

'use strict';

const oc = require('./option-chain');

const DEFAULTS = Object.freeze({
  buyDelta:       0.50,   // ATM
  sellDelta:      0.30,   // 30Δ OTM (Bull Call: shorts the OTM call;
                          // Bear Put: shorts the OTM put -- abs(delta))
  minDte:         5,
  maxDte:         45,
  minCreditINR:   25,     // skip if net debit / lot is < this (noise)
  riskFreeRate:   0.07,
});

function _roundTo(n, p) { const m = Math.pow(10, p); return Math.round(n * m) / m; }

function _dteFromExpiry(expiryStr, asOf) {
  const expiry = new Date(expiryStr + 'T15:30:00+05:30');
  const now = asOf instanceof Date ? asOf : new Date();
  return Math.max(0, Math.floor((expiry.getTime() - now.getTime()) / (24 * 3600 * 1000)));
}

/**
 * Pick the best expiry from a chain given a DTE band. Favours middle of band.
 */
function _pickExpiry(chain, minDte, maxDte, asOf) {
  const dteByExpiry = {};
  for (const row of chain) {
    if (!row.expiry) continue;
    if (dteByExpiry[row.expiry] != null) continue;
    dteByExpiry[row.expiry] = _dteFromExpiry(row.expiry, asOf);
  }
  const eligible = Object.entries(dteByExpiry)
    .filter(([_, d]) => d >= minDte && d <= maxDte);
  if (eligible.length === 0) return null;
  const midDte = (minDte + maxDte) / 2;
  eligible.sort((a, b) => Math.abs(a[1] - midDte) - Math.abs(b[1] - midDte));
  return eligible[0][0];
}

/**
 * Bull Call Spread: BUY low-strike call, SELL high-strike call.
 * Net debit; max-loss = debit; max-profit = (Kh - Kl) * lot - debit.
 */
function findBullCallSpread({ chain, opts = {} }) {
  if (!Array.isArray(chain) || chain.length === 0) return null;
  const cfg = { ...DEFAULTS, ...opts };
  const asOf = opts.asOf instanceof Date ? opts.asOf : new Date();
  const expiry = _pickExpiry(chain, cfg.minDte, cfg.maxDte, asOf);
  if (!expiry) return null;

  const buyLeg  = oc.pickStrikeByDelta(chain, { type: 'call', targetDelta: cfg.buyDelta,  expiry });
  const sellLeg = oc.pickStrikeByDelta(chain, { type: 'call', targetDelta: cfg.sellDelta, expiry });
  if (!buyLeg || !sellLeg) return null;
  if (buyLeg.strike >= sellLeg.strike) return null;  // sanity: must be Kl < Kh
  if (!buyLeg.greeks || !sellLeg.greeks) return null;

  const lotSize = buyLeg.lotSize || sellLeg.lotSize || 1;
  const buyPrice  = buyLeg.greeks.price;
  const sellPrice = sellLeg.greeks.price;
  const netDebitPerLot = (buyPrice - sellPrice) * lotSize;  // pay (buy) - receive (sell)
  if (!Number.isFinite(netDebitPerLot)) return null;
  if (netDebitPerLot < cfg.minCreditINR && netDebitPerLot > -cfg.minCreditINR) return null;

  const strikeWidth = sellLeg.strike - buyLeg.strike;
  const maxProfitPerLot = strikeWidth * lotSize - netDebitPerLot;
  const maxLossPerLot = netDebitPerLot;

  return {
    type: 'bull_call_spread',
    expiry,
    dte: _dteFromExpiry(expiry, asOf),
    lotSize,
    buyLeg:  { symbol: buyLeg.symbol,  strike: buyLeg.strike,  delta: buyLeg.greeks.delta,  price: _roundTo(buyPrice, 2) },
    sellLeg: { symbol: sellLeg.symbol, strike: sellLeg.strike, delta: sellLeg.greeks.delta, price: _roundTo(sellPrice, 2) },
    strikeWidth,
    netDebitPerLot: _roundTo(netDebitPerLot, 2),
    maxProfitPerLot: _roundTo(maxProfitPerLot, 2),
    maxLossPerLot:   _roundTo(maxLossPerLot, 2),
    breakeven: _roundTo(buyLeg.strike + (netDebitPerLot / lotSize), 2),
    riskRewardRatio: maxLossPerLot > 0 ? _roundTo(maxProfitPerLot / maxLossPerLot, 2) : null,
  };
}

/**
 * Bear Put Spread: BUY high-strike put, SELL low-strike put.
 * Net debit; max-loss = debit; max-profit = (Kh - Kl) * lot - debit.
 */
function findBearPutSpread({ chain, opts = {} }) {
  if (!Array.isArray(chain) || chain.length === 0) return null;
  const cfg = { ...DEFAULTS, ...opts };
  const asOf = opts.asOf instanceof Date ? opts.asOf : new Date();
  const expiry = _pickExpiry(chain, cfg.minDte, cfg.maxDte, asOf);
  if (!expiry) return null;

  // For puts, delta is negative. pickStrikeByDelta uses |delta|, so:
  // BUY put with |delta| ~0.50 (higher strike, more ITM)
  // SELL put with |delta| ~0.30 (lower strike, more OTM)
  const buyLeg  = oc.pickStrikeByDelta(chain, { type: 'put', targetDelta: cfg.buyDelta,  expiry });
  const sellLeg = oc.pickStrikeByDelta(chain, { type: 'put', targetDelta: cfg.sellDelta, expiry });
  if (!buyLeg || !sellLeg) return null;
  if (buyLeg.strike <= sellLeg.strike) return null;  // sanity: Kh > Kl for bear put
  if (!buyLeg.greeks || !sellLeg.greeks) return null;

  const lotSize = buyLeg.lotSize || sellLeg.lotSize || 1;
  const buyPrice  = buyLeg.greeks.price;
  const sellPrice = sellLeg.greeks.price;
  const netDebitPerLot = (buyPrice - sellPrice) * lotSize;
  if (!Number.isFinite(netDebitPerLot)) return null;
  if (Math.abs(netDebitPerLot) < cfg.minCreditINR) return null;

  const strikeWidth = buyLeg.strike - sellLeg.strike;
  const maxProfitPerLot = strikeWidth * lotSize - netDebitPerLot;
  const maxLossPerLot = netDebitPerLot;

  return {
    type: 'bear_put_spread',
    expiry,
    dte: _dteFromExpiry(expiry, asOf),
    lotSize,
    buyLeg:  { symbol: buyLeg.symbol,  strike: buyLeg.strike,  delta: buyLeg.greeks.delta,  price: _roundTo(buyPrice, 2) },
    sellLeg: { symbol: sellLeg.symbol, strike: sellLeg.strike, delta: sellLeg.greeks.delta, price: _roundTo(sellPrice, 2) },
    strikeWidth,
    netDebitPerLot: _roundTo(netDebitPerLot, 2),
    maxProfitPerLot: _roundTo(maxProfitPerLot, 2),
    maxLossPerLot:   _roundTo(maxLossPerLot, 2),
    breakeven: _roundTo(buyLeg.strike - (netDebitPerLot / lotSize), 2),
    riskRewardRatio: maxLossPerLot > 0 ? _roundTo(maxProfitPerLot / maxLossPerLot, 2) : null,
  };
}

/**
 * Attach P&L scenarios at expiry for spot moves.
 */
function priceSpread(opp) {
  if (!opp) return null;
  const isBull = opp.type === 'bull_call_spread';
  const Kl = isBull ? opp.buyLeg.strike : opp.sellLeg.strike;
  const Kh = isBull ? opp.sellLeg.strike : opp.buyLeg.strike;
  const lot = opp.lotSize;
  const debit = opp.netDebitPerLot;

  // Compute P&L per lot at a given final spot.
  // Bull call: payoff = max(spot - Kl, 0) - max(spot - Kh, 0), then * lot - debit
  // Bear put:  payoff = max(Kh - spot, 0) - max(Kl - spot, 0), then * lot - debit
  function pnlAt(spot) {
    let payoff;
    if (isBull) {
      payoff = Math.max(spot - Kl, 0) - Math.max(spot - Kh, 0);
    } else {
      payoff = Math.max(Kh - spot, 0) - Math.max(Kl - spot, 0);
    }
    return payoff * lot - debit;
  }

  // Generate 7 scenarios across the strike range
  const range = Kh - Kl;
  const center = (Kl + Kh) / 2;
  const scenarios = [-1.5, -1.0, -0.5, 0, 0.5, 1.0, 1.5].map(m => {
    const spot = _roundTo(center + range * m, 2);
    return {
      finalSpot: spot,
      pnlPerLot: _roundTo(pnlAt(spot), 2),
      profitable: pnlAt(spot) > 0,
    };
  });

  return { ...opp, scenarios };
}

// ---- Smoke tests ----

const SMOKE = () => {
  const oc2 = require('./option-chain');
  const today = new Date('2026-05-21T10:00:00+05:30');
  const expiry = new Date(today.getTime() + 14 * 24 * 3600 * 1000);
  const expiryStr = expiry.toISOString().slice(0, 10);

  const raw = [];
  for (const k of [24000, 24200, 24400, 24500, 24600, 24800, 25000]) {
    raw.push({ name: 'NIFTY', segment: 'NFO-OPT', instrument_type: 'CE',
               tradingsymbol: `NIFTY${k}CE`, instrument_token: 1000000+k,
               strike: k, expiry: expiryStr, lot_size: 75 });
    raw.push({ name: 'NIFTY', segment: 'NFO-OPT', instrument_type: 'PE',
               tradingsymbol: `NIFTY${k}PE`, instrument_token: 2000000+k,
               strike: k, expiry: expiryStr, lot_size: 75 });
  }
  const parsed = oc2.parseKiteInstruments(raw, 'NIFTY', { asOf: today });
  const enriched = oc2.enrichWithGreeks(parsed, { spot: 24500, riskFreeRate: 0.07, asOf: today, assumedIV: 0.15 });

  // --- Bull Call Spread ---
  const bull = findBullCallSpread({ chain: enriched, opts: { asOf: today } });
  let pass = 0, fail = 0;

  function check(label, cond) {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else      { fail++; console.log(`  FAIL  ${label}`); }
  }

  check('Bull Call Spread returned', !!bull);
  if (bull) {
    check('  type = bull_call_spread', bull.type === 'bull_call_spread');
    check('  buy.strike < sell.strike', bull.buyLeg.strike < bull.sellLeg.strike);
    check('  netDebit > 0 (paying premium)', bull.netDebitPerLot > 0);
    check('  maxProfit > maxLoss (or comparable)', bull.maxProfitPerLot > 0);
    check('  breakeven between strikes', bull.breakeven > bull.buyLeg.strike && bull.breakeven < bull.sellLeg.strike);

    const priced = priceSpread(bull);
    check('  7 scenarios computed', Array.isArray(priced.scenarios) && priced.scenarios.length === 7);
    const above = priced.scenarios.find(s => s.finalSpot > bull.sellLeg.strike + 50);
    check('  scenario above Kh -> max profit', above && Math.abs(above.pnlPerLot - bull.maxProfitPerLot) < 1);
    const below = priced.scenarios.find(s => s.finalSpot < bull.buyLeg.strike - 50);
    check('  scenario below Kl -> max loss', below && Math.abs(below.pnlPerLot - (-bull.maxLossPerLot)) < 1);
  }

  // --- Bear Put Spread ---
  const bear = findBearPutSpread({ chain: enriched, opts: { asOf: today } });
  check('Bear Put Spread returned', !!bear);
  if (bear) {
    check('  type = bear_put_spread', bear.type === 'bear_put_spread');
    check('  buy.strike > sell.strike', bear.buyLeg.strike > bear.sellLeg.strike);
    check('  netDebit > 0', bear.netDebitPerLot > 0);
    const priced = priceSpread(bear);
    const below = priced.scenarios.find(s => s.finalSpot < bear.sellLeg.strike - 50);
    check('  scenario below Kl -> max profit', below && Math.abs(below.pnlPerLot - bear.maxProfitPerLot) < 1);
    const above = priced.scenarios.find(s => s.finalSpot > bear.buyLeg.strike + 50);
    check('  scenario above Kh -> max loss', above && Math.abs(above.pnlPerLot - (-bear.maxLossPerLot)) < 1);
  }

  // Empty chain
  check('empty chain -> null Bull Call', findBullCallSpread({ chain: [] }) === null);
  check('empty chain -> null Bear Put',  findBearPutSpread({ chain: [] }) === null);

  console.log(`\nSmoke: ${pass} pass, ${fail} fail.`);
  if (fail > 0) process.exit(1);
};

if (require.main === module && process.argv.includes('--smoke')) {
  SMOKE();
}

module.exports = {
  findBullCallSpread,
  findBearPutSpread,
  priceSpread,
  DEFAULTS,
};

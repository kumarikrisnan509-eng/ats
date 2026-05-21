// T-291a -- Iron Condor strategy template (Phase 4 logic layer).
//
// Pure functions. 4-leg neutral-bias strategy that collects premium from
// theta decay when the market stays range-bound. The classic income trade
// for neutral / low-vol regimes.
//
//   Iron Condor (sold)
//     SELL call at higher OTM strike (Ksc)            (~15-20Δ)
//     BUY  call at further OTM strike (Klc)           (~5-10Δ) -- wing protection
//     SELL put  at lower OTM strike  (Ksp)            (~15-20Δ in absolute)
//     BUY  put  at further OTM strike (Klp)           (~5-10Δ in absolute)
//   where Klp < Ksp < spot < Ksc < Klc
//
//   Net CREDIT (you receive premium up front).
//   Max profit = net credit, if spot ends inside [Ksp, Ksc] at expiry.
//   Max loss   = (Ksc - Klc... wait, wing width) - credit. Symmetric for puts.
//   Breakeven  = Ksc + credit/lot (upper), Ksp - credit/lot (lower).
//
// Public API:
//   findIronCondor({ chain, opts })   -> opportunity | null
//   priceCondor(opp)                   -> opp + payoff scenarios across 7 spot points

'use strict';

const oc = require('./option-chain');

const DEFAULTS = Object.freeze({
  shortDelta:    0.18,     // sell OTM at ~18Δ (about 18% prob of ITM)
  longDelta:     0.08,     // buy further OTM at ~8Δ (cheap protection)
  minDte:        7,        // skip if too close (gamma)
  maxDte:        45,       // skip if too far (theta too slow)
  minCreditINR:  100,      // skip if total credit < this
  riskFreeRate:  0.07,
});

function _roundTo(n, p) { const m = Math.pow(10, p); return Math.round(n * m) / m; }
function _dteFromExpiry(expiryStr, asOf) {
  const expiry = new Date(expiryStr + 'T15:30:00+05:30');
  const now = asOf instanceof Date ? asOf : new Date();
  return Math.max(0, Math.floor((expiry.getTime() - now.getTime()) / (24 * 3600 * 1000)));
}
function _pickExpiry(chain, minDte, maxDte, asOf) {
  const seen = {};
  for (const r of chain) {
    if (r.expiry && seen[r.expiry] == null) seen[r.expiry] = _dteFromExpiry(r.expiry, asOf);
  }
  const eligible = Object.entries(seen).filter(([_, d]) => d >= minDte && d <= maxDte);
  if (eligible.length === 0) return null;
  const midDte = (minDte + maxDte) / 2;
  eligible.sort((a, b) => Math.abs(a[1] - midDte) - Math.abs(b[1] - midDte));
  return eligible[0][0];
}

function findIronCondor({ chain, opts = {} }) {
  if (!Array.isArray(chain) || chain.length === 0) return null;
  const cfg = { ...DEFAULTS, ...opts };
  const asOf = opts.asOf instanceof Date ? opts.asOf : new Date();
  const expiry = _pickExpiry(chain, cfg.minDte, cfg.maxDte, asOf);
  if (!expiry) return null;

  const callShort = oc.pickStrikeByDelta(chain, { type: 'call', targetDelta: cfg.shortDelta, expiry });
  const callLong  = oc.pickStrikeByDelta(chain, { type: 'call', targetDelta: cfg.longDelta,  expiry });
  const putShort  = oc.pickStrikeByDelta(chain, { type: 'put',  targetDelta: cfg.shortDelta, expiry });
  const putLong   = oc.pickStrikeByDelta(chain, { type: 'put',  targetDelta: cfg.longDelta,  expiry });

  if (!callShort || !callLong || !putShort || !putLong) return null;
  if (!callShort.greeks || !callLong.greeks || !putShort.greeks || !putLong.greeks) return null;

  // Sanity: Klp < Ksp < Ksc < Klc, and short strikes are different from long
  if (!(putLong.strike < putShort.strike && putShort.strike < callShort.strike && callShort.strike < callLong.strike)) {
    return null;
  }

  const lotSize = callShort.lotSize || 1;
  // Credits (received) for short legs, debits (paid) for long legs.
  // Net credit per lot = (callShort.price + putShort.price - callLong.price - putLong.price) * lotSize
  const creditPerLot =
    (callShort.greeks.price + putShort.greeks.price
     - callLong.greeks.price - putLong.greeks.price) * lotSize;
  if (!Number.isFinite(creditPerLot) || creditPerLot < cfg.minCreditINR) return null;

  const callWingWidth = callLong.strike - callShort.strike;
  const putWingWidth  = putShort.strike - putLong.strike;
  // Max loss = wider wing - credit (assumes wings are equal; if not, use the wider)
  const wingWidth = Math.max(callWingWidth, putWingWidth);
  const maxLossPerLot = wingWidth * lotSize - creditPerLot;
  const maxProfitPerLot = creditPerLot;

  return {
    type: 'iron_condor',
    expiry,
    dte: _dteFromExpiry(expiry, asOf),
    lotSize,
    legs: {
      callShort: { symbol: callShort.symbol, strike: callShort.strike, delta: callShort.greeks.delta, price: _roundTo(callShort.greeks.price, 2) },
      callLong:  { symbol: callLong.symbol,  strike: callLong.strike,  delta: callLong.greeks.delta,  price: _roundTo(callLong.greeks.price, 2) },
      putShort:  { symbol: putShort.symbol,  strike: putShort.strike,  delta: putShort.greeks.delta,  price: _roundTo(putShort.greeks.price, 2) },
      putLong:   { symbol: putLong.symbol,   strike: putLong.strike,   delta: putLong.greeks.delta,   price: _roundTo(putLong.greeks.price, 2) },
    },
    callWingWidth,
    putWingWidth,
    creditPerLot:   _roundTo(creditPerLot, 2),
    maxProfitPerLot: _roundTo(maxProfitPerLot, 2),
    maxLossPerLot:   _roundTo(maxLossPerLot, 2),
    breakevenUpper: _roundTo(callShort.strike + creditPerLot / lotSize, 2),
    breakevenLower: _roundTo(putShort.strike - creditPerLot / lotSize, 2),
    profitZone:     [putShort.strike, callShort.strike],   // spot must end here
    riskRewardRatio: maxLossPerLot > 0 ? _roundTo(maxProfitPerLot / maxLossPerLot, 2) : null,
  };
}

/**
 * Iron Condor expiry P&L:
 *   payoff per lot at final spot S =
 *     credit
 *     - max(S - callShort.K, 0) * lot   (short call assigned)
 *     + max(S - callLong.K, 0) * lot    (long call exercised)
 *     - max(putShort.K - S, 0) * lot    (short put assigned)
 *     + max(putLong.K - S, 0) * lot     (long put exercised)
 */
function priceCondor(opp) {
  if (!opp || opp.type !== 'iron_condor') return null;
  const lot = opp.lotSize;
  const cs = opp.legs.callShort.strike;
  const cl = opp.legs.callLong.strike;
  const ps = opp.legs.putShort.strike;
  const pl = opp.legs.putLong.strike;
  const credit = opp.creditPerLot;

  function pnlAt(S) {
    return credit
      - Math.max(S - cs, 0) * lot
      + Math.max(S - cl, 0) * lot
      - Math.max(ps - S, 0) * lot
      + Math.max(pl - S, 0) * lot;
  }

  // 7 scenarios spanning the wings
  const range = (cl - pl);
  const center = (ps + cs) / 2;
  const points = [pl - range * 0.1, pl, ps, center, cs, cl, cl + range * 0.1];
  const scenarios = points.map(S => {
    const p = pnlAt(S);
    return {
      finalSpot: _roundTo(S, 2),
      pnlPerLot: _roundTo(p, 2),
      profitable: p > 0,
    };
  });

  return { ...opp, scenarios };
}

// ---- Smoke tests ----

const SMOKE = () => {
  const oc2 = require('./option-chain');
  const today = new Date('2026-05-21T10:00:00+05:30');
  const expiry = new Date(today.getTime() + 21 * 24 * 3600 * 1000);  // 3 weeks
  const expiryStr = expiry.toISOString().slice(0, 10);

  const raw = [];
  // Wide strike range so we have OTM wings on both sides
  for (const k of [22500, 23000, 23300, 23500, 23800, 24000, 24200, 24300, 24400, 24500, 24600, 24700, 24800, 25000, 25200, 25500, 25800, 26200, 26700, 27000]) {
    raw.push({ name: 'NIFTY', segment: 'NFO-OPT', instrument_type: 'CE',
               tradingsymbol: `NIFTY${k}CE`, instrument_token: 1000000+k,
               strike: k, expiry: expiryStr, lot_size: 75 });
    raw.push({ name: 'NIFTY', segment: 'NFO-OPT', instrument_type: 'PE',
               tradingsymbol: `NIFTY${k}PE`, instrument_token: 2000000+k,
               strike: k, expiry: expiryStr, lot_size: 75 });
  }
  const parsed = oc2.parseKiteInstruments(raw, 'NIFTY', { asOf: today });
  const enriched = oc2.enrichWithGreeks(parsed, { spot: 24500, riskFreeRate: 0.07, asOf: today, assumedIV: 0.15 });

  const ic = findIronCondor({ chain: enriched, opts: { asOf: today } });

  let pass = 0, fail = 0;
  function check(label, cond) {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else      { fail++; console.log(`  FAIL  ${label}`); }
  }

  check('Iron Condor returned', !!ic);
  if (ic) {
    check('  type = iron_condor', ic.type === 'iron_condor');
    const { callShort, callLong, putShort, putLong } = ic.legs;
    check('  putLong < putShort < callShort < callLong (strike order)',
      putLong.strike < putShort.strike && putShort.strike < callShort.strike && callShort.strike < callLong.strike);
    check('  putShort < spot=24500 < callShort (wings around spot)',
      putShort.strike < 24500 && 24500 < callShort.strike);
    check('  credit > 0 (premium received)', ic.creditPerLot > 0);
    check('  maxLoss > 0 (defined risk)', ic.maxLossPerLot > 0);
    check('  maxProfit < maxLoss (typical for IC; collect premium, risk wing)', ic.maxProfitPerLot < ic.maxLossPerLot);
    check('  breakevenLower < putShort.strike', ic.breakevenLower < putShort.strike);
    check('  breakevenUpper > callShort.strike', ic.breakevenUpper > callShort.strike);

    const priced = priceCondor(ic);
    check('  7 scenarios generated', Array.isArray(priced.scenarios) && priced.scenarios.length === 7);

    // Center of profit zone (between short strikes) should be profitable (max profit)
    const centerScenario = priced.scenarios.find(s =>
      s.finalSpot > putShort.strike && s.finalSpot < callShort.strike
    );
    check('  inside profit zone -> profitable', centerScenario && centerScenario.profitable);
    check('  inside profit zone P&L ≈ max profit',
      centerScenario && Math.abs(centerScenario.pnlPerLot - ic.maxProfitPerLot) < 1);

    // Far above callLong: capped at call-wing loss (callWingWidth * lot - credit)
    // Note: this may be LESS than overall maxLoss if put wing is wider.
    const farAbove = priced.scenarios.find(s => s.finalSpot > callLong.strike);
    const callWingLoss = ic.callWingWidth * ic.lotSize - ic.creditPerLot;
    check('  far above callLong -> call-wing loss',
      farAbove && Math.abs(farAbove.pnlPerLot - (-callWingLoss)) < 1);

    // Far below putLong: capped at put-wing loss (putWingWidth * lot - credit)
    const farBelow = priced.scenarios.find(s => s.finalSpot < putLong.strike);
    const putWingLoss = ic.putWingWidth * ic.lotSize - ic.creditPerLot;
    check('  far below putLong -> put-wing loss',
      farBelow && Math.abs(farBelow.pnlPerLot - (-putWingLoss)) < 1);
  }

  check('empty chain -> null', findIronCondor({ chain: [] }) === null);

  console.log(`\nSmoke: ${pass} pass, ${fail} fail.`);
  if (fail > 0) process.exit(1);
};

if (require.main === module && process.argv.includes('--smoke')) {
  SMOKE();
}

module.exports = {
  findIronCondor,
  priceCondor,
  DEFAULTS,
};

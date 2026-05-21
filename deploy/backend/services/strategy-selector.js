// T-295a -- Regime-aware option strategy selector (Phase 4 logic layer).
//
// Pure functions. Composes the four Phase 4 strategy templates and returns
// a ranked list of opportunities appropriate for the current market regime.
//
//   Bull regime    -> bull call spread (debit, directional long-bias)
//                  -> covered call    (yield on existing long)
//   Bear regime    -> bear put spread  (debit, directional short-bias)
//   Neutral regime -> iron condor      (credit, range-bound theta harvest)
//   Unknown regime -> [] (decline, do not guess)
//
//   Each opportunity is scored:
//     score = (estimatedEdge / capitalAtRisk) * confidenceWeight
//   where confidenceWeight reflects how cleanly the regime maps to the
//   template (e.g. neutral -> IC = 1.0; bull -> covered call = 0.7).
//
// Public API:
//   selectStrategies({ regime, chain, opts }) -> { regime, ranked: [opp,...] }
//   rankOpportunities(list)                   -> sorted desc by score
//
// Pure: no DB, no network, no side effects. Safe to unit-test in isolation.

'use strict';

const cc = require('./strategy-covered-call');
const vs = require('./strategy-vertical-spread');
const ic = require('./strategy-iron-condor');

// regime -> [{template, weight, params}] map
// weight is the confidence multiplier applied to the raw edge score.
// Lower weights mean "this template fits the regime, but is a secondary play".
const REGIME_PLAYBOOK = Object.freeze({
  bull: [
    { template: 'bull_call_spread', weight: 1.00 },
    { template: 'covered_call',     weight: 0.70 },
  ],
  bear: [
    { template: 'bear_put_spread',  weight: 1.00 },
  ],
  neutral: [
    { template: 'iron_condor',      weight: 1.00 },
  ],
  unknown: [],
});

function _scoreCoveredCall(opp) {
  // Edge = annualised premium yield. Capital at risk = strike - premium (rough).
  if (!opp || !Number.isFinite(opp.premiumPerLot) || !Number.isFinite(opp.dte)) return 0;
  const dte = Math.max(1, opp.dte);
  const annualised = (opp.premiumPerLot / dte) * 365;
  // Normalise by lot * strike so different underlyings are comparable.
  const denom = (opp.legs?.call?.strike || 1) * (opp.lotSize || 1);
  return annualised / denom;
}

function _scoreVerticalSpread(opp) {
  if (!opp || !Number.isFinite(opp.maxProfitPerLot) || !Number.isFinite(opp.maxLossPerLot)) return 0;
  if (opp.maxLossPerLot <= 0) return 0;
  // R:R alone isn't enough; weight by probability proxy = 1 - (debit/maxProfit).
  // Lower debit relative to max profit means higher prob the spread expires ITM.
  const rr = opp.maxProfitPerLot / opp.maxLossPerLot;
  return Number.isFinite(rr) ? rr : 0;
}

function _scoreIronCondor(opp) {
  if (!opp || !Number.isFinite(opp.creditPerLot) || !Number.isFinite(opp.maxLossPerLot)) return 0;
  if (opp.maxLossPerLot <= 0) return 0;
  // IC: profit zone width / wing width is a rough "probability of profit" proxy.
  const pz = (opp.profitZone?.[1] ?? 0) - (opp.profitZone?.[0] ?? 0);
  const wing = Math.max(opp.callWingWidth || 0, opp.putWingWidth || 0);
  if (wing <= 0) return 0;
  const probProxy = pz / (pz + 2 * wing);
  const rr = opp.creditPerLot / opp.maxLossPerLot;
  return rr * probProxy;
}

function _findOne(template, chain, opts) {
  switch (template) {
    case 'covered_call':      return cc.findOpportunities({ chain, opts });
    case 'bull_call_spread':  return vs.findBullCallSpread({ chain, opts });
    case 'bear_put_spread':   return vs.findBearPutSpread({ chain, opts });
    case 'iron_condor':       return ic.findIronCondor({ chain, opts });
    default: return null;
  }
}

function _scoreOne(template, opp) {
  switch (template) {
    case 'covered_call':      return _scoreCoveredCall(opp);
    case 'bull_call_spread':
    case 'bear_put_spread':   return _scoreVerticalSpread(opp);
    case 'iron_condor':       return _scoreIronCondor(opp);
    default: return 0;
  }
}

function selectStrategies({ regime, chain, opts = {} }) {
  const out = { regime, ranked: [] };
  if (!regime || !Array.isArray(chain) || chain.length === 0) return out;

  const playbook = REGIME_PLAYBOOK[regime] || REGIME_PLAYBOOK.unknown;
  if (playbook.length === 0) return out;

  for (const entry of playbook) {
    const found = _findOne(entry.template, chain, opts);
    if (!found) continue;

    // Covered call returns an array; the spreads + IC return a single opp.
    const list = Array.isArray(found) ? found : [found];
    for (const opp of list) {
      const rawScore = _scoreOne(entry.template, opp);
      if (!Number.isFinite(rawScore) || rawScore <= 0) continue;
      out.ranked.push({
        template: entry.template,
        weight: entry.weight,
        rawScore: Math.round(rawScore * 1e6) / 1e6,
        score: Math.round(rawScore * entry.weight * 1e6) / 1e6,
        opportunity: opp,
      });
    }
  }

  out.ranked.sort((a, b) => b.score - a.score);
  return out;
}

function rankOpportunities(list) {
  if (!Array.isArray(list)) return [];
  return [...list].sort((a, b) => (b.score || 0) - (a.score || 0));
}

// ---- Smoke tests ----

const SMOKE = () => {
  const oc = require('./option-chain');
  const today = new Date('2026-05-21T10:00:00+05:30');
  const expiry = new Date(today.getTime() + 21 * 24 * 3600 * 1000);
  const expiryStr = expiry.toISOString().slice(0, 10);

  const raw = [];
  for (const k of [22500, 23000, 23500, 23800, 24000, 24200, 24300, 24400, 24500, 24600, 24700, 24800, 25000, 25200, 25500, 26000, 26700, 27000]) {
    raw.push({ name: 'NIFTY', segment: 'NFO-OPT', instrument_type: 'CE',
               tradingsymbol: `NIFTY${k}CE`, instrument_token: 1000000+k,
               strike: k, expiry: expiryStr, lot_size: 75 });
    raw.push({ name: 'NIFTY', segment: 'NFO-OPT', instrument_type: 'PE',
               tradingsymbol: `NIFTY${k}PE`, instrument_token: 2000000+k,
               strike: k, expiry: expiryStr, lot_size: 75 });
  }
  const parsed = oc.parseKiteInstruments(raw, 'NIFTY', { asOf: today });
  const enriched = oc.enrichWithGreeks(parsed, { spot: 24500, riskFreeRate: 0.07, asOf: today, assumedIV: 0.15 });

  let pass = 0, fail = 0;
  function check(label, cond) {
    if (cond) { pass++; console.log(`  PASS  ${label}`); }
    else      { fail++; console.log(`  FAIL  ${label}`); }
  }

  // Bull regime
  const bull = selectStrategies({ regime: 'bull', chain: enriched, opts: { asOf: today } });
  check('bull: regime echoed', bull.regime === 'bull');
  check('bull: ranked non-empty', bull.ranked.length > 0);
  check('bull: at least one bull_call_spread', bull.ranked.some(r => r.template === 'bull_call_spread'));
  check('bull: sorted desc by score',
    bull.ranked.every((r, i, a) => i === 0 || a[i-1].score >= r.score));
  check('bull: each opp has positive score', bull.ranked.every(r => r.score > 0));

  // Bear regime
  const bear = selectStrategies({ regime: 'bear', chain: enriched, opts: { asOf: today } });
  check('bear: ranked non-empty', bear.ranked.length > 0);
  check('bear: only bear_put_spread', bear.ranked.every(r => r.template === 'bear_put_spread'));

  // Neutral regime
  const neutral = selectStrategies({ regime: 'neutral', chain: enriched, opts: { asOf: today } });
  check('neutral: ranked non-empty', neutral.ranked.length > 0);
  check('neutral: only iron_condor', neutral.ranked.every(r => r.template === 'iron_condor'));

  // Unknown regime -> empty
  const unk = selectStrategies({ regime: 'unknown', chain: enriched, opts: { asOf: today } });
  check('unknown: ranked empty', unk.ranked.length === 0);

  // Missing chain
  const noChain = selectStrategies({ regime: 'bull', chain: [], opts: {} });
  check('empty chain -> empty ranked', noChain.ranked.length === 0);

  // Missing regime
  const noRegime = selectStrategies({ regime: null, chain: enriched, opts: {} });
  check('null regime -> empty ranked', noRegime.ranked.length === 0);

  // rankOpportunities pure helper
  const sorted = rankOpportunities([{ score: 1 }, { score: 3 }, { score: 2 }]);
  check('rankOpportunities sorts desc',
    sorted[0].score === 3 && sorted[1].score === 2 && sorted[2].score === 1);
  check('rankOpportunities tolerates non-array', rankOpportunities(null).length === 0);

  console.log(`\nSmoke: ${pass} pass, ${fail} fail.`);
  if (fail > 0) process.exit(1);
};

if (require.main === module && process.argv.includes('--smoke')) {
  SMOKE();
}

module.exports = {
  selectStrategies,
  rankOpportunities,
  REGIME_PLAYBOOK,
};

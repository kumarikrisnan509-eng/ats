// T-296a CI tests -- option strategy templates + regime selector.
// Covers: covered call, bull/bear vertical spreads, iron condor, selector.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const oc = require('../services/option-chain');
const cc = require('../services/strategy-covered-call');
const vs = require('../services/strategy-vertical-spread');
const ic = require('../services/strategy-iron-condor');
const sel = require('../services/strategy-selector');

const asOf = new Date('2026-05-21T10:00:00+05:30');
const expiry = new Date(asOf.getTime() + 21 * 24 * 3600 * 1000);
const expiryStr = expiry.toISOString().slice(0, 10);

function buildChain() {
  const raw = [];
  for (const k of [22500, 23000, 23500, 23800, 24000, 24200, 24300, 24400, 24500, 24600, 24700, 24800, 25000, 25200, 25500, 26000, 26700, 27000]) {
    raw.push({ name: 'NIFTY', segment: 'NFO-OPT', instrument_type: 'CE',
               tradingsymbol: `NIFTY${k}CE`, instrument_token: 1000000 + k,
               strike: k, expiry: expiryStr, lot_size: 75 });
    raw.push({ name: 'NIFTY', segment: 'NFO-OPT', instrument_type: 'PE',
               tradingsymbol: `NIFTY${k}PE`, instrument_token: 2000000 + k,
               strike: k, expiry: expiryStr, lot_size: 75 });
  }
  const parsed = oc.parseKiteInstruments(raw, 'NIFTY', { asOf });
  return oc.enrichWithGreeks(parsed, { spot: 24500, riskFreeRate: 0.07, asOf, assumedIV: 0.15 });
}

const HOLDINGS = [{ symbol: 'NIFTY', qty: 750, avgPrice: 24000, ltp: 24500 }];

// ---- Covered Call ----

test('covered call: returns array of opportunities with holdings', () => {
  const chain = buildChain();
  const opps = cc.findOpportunities({ holdings: HOLDINGS, chain, opts: { asOf } });
  assert.ok(Array.isArray(opps));
  assert.ok(opps.length > 0);
});

test('covered call: short strike is OTM (strike > 24500 spot)', () => {
  const chain = buildChain();
  const opps = cc.findOpportunities({ holdings: HOLDINGS, chain, opts: { asOf } });
  for (const o of opps) {
    assert.ok(o.strike > 24500, `strike ${o.strike} not OTM`);
  }
});

test('covered call: priceOpportunity returns expiry scenarios', () => {
  const chain = buildChain();
  const opps = cc.findOpportunities({ holdings: HOLDINGS, chain, opts: { asOf } });
  const priced = cc.priceOpportunity(opps[0]);
  assert.ok(priced, 'priced result returned');
  assert.ok(Array.isArray(priced.scenarios));
  assert.ok(priced.scenarios.length > 0);
});

// ---- Bull Call Spread ----

test('bull call spread: buy strike < sell strike', () => {
  const chain = buildChain();
  const opp = vs.findBullCallSpread({ chain, opts: { asOf } });
  assert.ok(opp);
  assert.equal(opp.type, 'bull_call_spread');
  assert.ok(opp.buyLeg.strike < opp.sellLeg.strike);
});

test('bull call spread: maxLoss > 0 and R:R defined', () => {
  const chain = buildChain();
  const opp = vs.findBullCallSpread({ chain, opts: { asOf } });
  assert.ok(opp.maxLossPerLot > 0);
  assert.ok(opp.maxProfitPerLot > 0);
});

// ---- Bear Put Spread ----

test('bear put spread: buy strike > sell strike (puts mirror)', () => {
  const chain = buildChain();
  const opp = vs.findBearPutSpread({ chain, opts: { asOf } });
  assert.ok(opp);
  assert.equal(opp.type, 'bear_put_spread');
  assert.ok(opp.buyLeg.strike > opp.sellLeg.strike);
});

// ---- Iron Condor ----

test('iron condor: 4 legs in correct strike order', () => {
  const chain = buildChain();
  const opp = ic.findIronCondor({ chain, opts: { asOf } });
  assert.ok(opp);
  const { putLong, putShort, callShort, callLong } = opp.legs;
  assert.ok(putLong.strike < putShort.strike);
  assert.ok(putShort.strike < callShort.strike);
  assert.ok(callShort.strike < callLong.strike);
});

test('iron condor: net credit and defined max loss', () => {
  const chain = buildChain();
  const opp = ic.findIronCondor({ chain, opts: { asOf } });
  assert.ok(opp.creditPerLot > 0);
  assert.ok(opp.maxLossPerLot > 0);
  assert.ok(opp.maxProfitPerLot < opp.maxLossPerLot, 'IC has R:R < 1');
});

test('iron condor: profit zone surrounds spot', () => {
  const chain = buildChain();
  const opp = ic.findIronCondor({ chain, opts: { asOf } });
  const [low, high] = opp.profitZone;
  assert.ok(low < 24500 && 24500 < high, `profit zone [${low},${high}] surrounds 24500`);
});

// ---- Selector ----

test('selector: bull regime returns ranked desc', () => {
  const chain = buildChain();
  const r = sel.selectStrategies({ regime: 'bull', chain, opts: { asOf } });
  assert.equal(r.regime, 'bull');
  assert.ok(r.ranked.length > 0);
  for (let i = 1; i < r.ranked.length; i++) {
    assert.ok(r.ranked[i - 1].score >= r.ranked[i].score);
  }
});

test('selector: bull regime + holdings includes covered_call', () => {
  const chain = buildChain();
  const r = sel.selectStrategies({
    regime: 'bull', chain,
    opts: { asOf, holdings: HOLDINGS },
  });
  assert.ok(r.ranked.some(x => x.template === 'covered_call'));
});

test('selector: bear regime returns only bear_put_spread', () => {
  const chain = buildChain();
  const r = sel.selectStrategies({ regime: 'bear', chain, opts: { asOf } });
  assert.ok(r.ranked.length > 0);
  for (const x of r.ranked) {
    assert.equal(x.template, 'bear_put_spread');
  }
});

test('selector: neutral regime returns only iron_condor', () => {
  const chain = buildChain();
  const r = sel.selectStrategies({ regime: 'neutral', chain, opts: { asOf } });
  assert.ok(r.ranked.length > 0);
  for (const x of r.ranked) {
    assert.equal(x.template, 'iron_condor');
  }
});

test('selector: unknown regime returns empty', () => {
  const chain = buildChain();
  const r = sel.selectStrategies({ regime: 'unknown', chain, opts: { asOf } });
  assert.deepEqual(r.ranked, []);
});

test('selector: empty chain returns empty ranked', () => {
  const r = sel.selectStrategies({ regime: 'bull', chain: [], opts: {} });
  assert.deepEqual(r.ranked, []);
});

test('selector: rankOpportunities sorts desc, tolerates non-array', () => {
  const sorted = sel.rankOpportunities([{ score: 1 }, { score: 3 }, { score: 2 }]);
  assert.equal(sorted[0].score, 3);
  assert.equal(sorted[2].score, 1);
  assert.deepEqual(sel.rankOpportunities(null), []);
});

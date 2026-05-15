const { test } = require('node:test');
const assert = require('node:assert/strict');
const { SpanSim, instrumentClass } = require('../span-sim');

// Fix `now` so daysToExpiry is deterministic across test runs.
const FIXED_NOW = new Date('2026-05-15T00:00:00Z').getTime();

const niftyLeg = (override = {}) => ({
  symbol: 'NIFTY', type: 'CALL', side: 'BUY', strike: 25000, expiry: '2026-06-25',
  qty: 1, lotSize: 25, spotPrice: 25000, iv: 0.18,
  ...override,
});
const stockLeg = (override = {}) => ({
  symbol: 'RELIANCE', type: 'CALL', side: 'BUY', strike: 3000, expiry: '2026-06-25',
  qty: 1, lotSize: 250, spotPrice: 2950, iv: 0.30,
  ...override,
});

test('instrumentClass: NIFTY/BANKNIFTY = index, RELIANCE = stock', () => {
  assert.equal(instrumentClass('NIFTY'), 'index');
  assert.equal(instrumentClass('BANKNIFTY'), 'index');
  assert.equal(instrumentClass('RELIANCE'), 'stock');
  assert.equal(instrumentClass('TATAMOTORS'), 'stock');
});

test('rejects empty legs', () => {
  const s = new SpanSim({ now: FIXED_NOW });
  assert.throws(() => s.estimate({ legs: [] }), /non-empty/);
});

test('rejects unknown type', () => {
  const s = new SpanSim({ now: FIXED_NOW });
  assert.throws(() => s.estimate({ legs: [niftyLeg({ type: 'STRADDLE' })] }), /CALL\|PUT\|FUT/);
});

test('single NIFTY futures long: SPAN ~7% + exposure 2% of notional', () => {
  const s = new SpanSim({ now: FIXED_NOW });
  const out = s.estimate({ legs: [{
    symbol: 'NIFTY', type: 'FUT', side: 'BUY', expiry: '2026-06-25',
    qty: 1, lotSize: 25, spotPrice: 25000,
  }]});
  assert.equal(out.ok, true);
  const notional = 25000 * 25; // 625k
  // SPAN ~ 7% = 43,750. Exposure ~ 2% = 12,500. Total ~ 56,250.
  assert.ok(out.spanMargin     > 40000 && out.spanMargin     < 50000, `spanMargin=${out.spanMargin}`);
  assert.ok(out.exposureMargin > 11000 && out.exposureMargin < 14000, `exposure=${out.exposureMargin}`);
  assert.ok(out.totalMargin    > 53000 && out.totalMargin    < 65000, `total=${out.totalMargin}`);
  assert.equal(out.perLeg.length, 1);
  assert.equal(out.perLeg[0].notional, notional);
});

test('long NIFTY CALL (ATM): margin = premium only, no exposure margin', () => {
  const s = new SpanSim({ now: FIXED_NOW });
  const out = s.estimate({ legs: [niftyLeg({ side: 'BUY', type: 'CALL', strike: 25000 })] });
  // Long option: exposure = 0
  assert.equal(out.exposureMargin, 0);
  assert.ok(out.totalMargin > 1000, `total too low: ${out.totalMargin}`);
  // For 25k * 25 = 625k notional, ATM long with iv 0.18 ~ 2-4% premium = 12,500-25,000.
  assert.ok(out.totalMargin < 40000, `total too high: ${out.totalMargin}`);
});

test('short NIFTY CALL is much more expensive than long', () => {
  const s = new SpanSim({ now: FIXED_NOW });
  const longOut  = s.estimate({ legs: [niftyLeg({ side: 'BUY',  type: 'CALL', strike: 25000 })] });
  const shortOut = s.estimate({ legs: [niftyLeg({ side: 'SELL', type: 'CALL', strike: 25000 })] });
  assert.ok(shortOut.totalMargin > longOut.totalMargin * 2,
    `short should be >= 2x long, got short=${shortOut.totalMargin} long=${longOut.totalMargin}`);
});

test('stock futures has higher margin % than index futures', () => {
  const s = new SpanSim({ now: FIXED_NOW });
  const idxFut = s.estimate({ legs: [{
    symbol: 'NIFTY', type: 'FUT', side: 'BUY', expiry: '2026-06-25',
    qty: 1, lotSize: 25, spotPrice: 25000,
  }]});
  const stkFut = s.estimate({ legs: [{
    symbol: 'RELIANCE', type: 'FUT', side: 'BUY', expiry: '2026-06-25',
    qty: 1, lotSize: 250, spotPrice: 2950,
  }]});
  // Margin as % of notional
  const idxPct = idxFut.totalMargin / idxFut.perLeg[0].notional;
  const stkPct = stkFut.totalMargin / stkFut.perLeg[0].notional;
  assert.ok(stkPct > idxPct, `expected stock pct (${(stkPct*100).toFixed(2)}%) > index pct (${(idxPct*100).toFixed(2)}%)`);
});

test('bull call spread: 1 long lower + 1 short higher -> spread detected, discount applied', () => {
  const s = new SpanSim({ now: FIXED_NOW });
  const out = s.estimate({ legs: [
    niftyLeg({ side: 'BUY',  type: 'CALL', strike: 25000 }),
    niftyLeg({ side: 'SELL', type: 'CALL', strike: 25500 }),
  ]});
  assert.ok(out.spreads.length >= 1);
  const bull = out.spreads.find(sp => sp.type === 'bull-call-spread');
  assert.ok(bull, 'bull-call-spread not detected');
  assert.deepEqual([...bull.legs].sort(), [0, 1]);
  // Total should be much less than the sum of the two legs' SPAN margins.
  assert.ok(out.perLeg[1].spanDiscount > 0.6, `short leg should get ~65% discount, got ${out.perLeg[1].spanDiscount}`);
});

test('bear put spread: long higher put + short lower put -> detected', () => {
  const s = new SpanSim({ now: FIXED_NOW });
  const out = s.estimate({ legs: [
    niftyLeg({ side: 'BUY',  type: 'PUT', strike: 25000 }),
    niftyLeg({ side: 'SELL', type: 'PUT', strike: 24500 }),
  ]});
  assert.ok(out.spreads.some(sp => sp.type === 'bear-put-spread'),
    'bear-put-spread missing, got: ' + out.spreads.map(s=>s.type).join(','));
});

test('iron condor: 4 legs detected as one spread', () => {
  const s = new SpanSim({ now: FIXED_NOW });
  const base = { symbol: 'NIFTY', expiry: '2026-06-25', qty: 1, lotSize: 25, spotPrice: 25000, iv: 0.18 };
  const out = s.estimate({ legs: [
    { ...base, type: 'PUT',  side: 'BUY',  strike: 24500 },
    { ...base, type: 'PUT',  side: 'SELL', strike: 24800 },
    { ...base, type: 'CALL', side: 'SELL', strike: 25200 },
    { ...base, type: 'CALL', side: 'BUY',  strike: 25500 },
  ]});
  assert.ok(out.spreads.some(sp => sp.type === 'iron-condor'),
    'iron-condor missing, got: ' + out.spreads.map(s=>s.type).join(','));
  // Should also see the embedded verticals (bull put + bear call) but iron-condor
  // gives the largest discount and wins on each leg.
  const totalShortLegMargin = out.perLeg
    .filter(l => l.side === 'SELL')
    .reduce((a, b) => a + b.spanMarginAfterDiscount, 0);
  const totalShortLegRaw = out.perLeg
    .filter(l => l.side === 'SELL')
    .reduce((a, b) => a + b.spanMargin, 0);
  assert.ok(totalShortLegMargin < totalShortLegRaw * 0.5,
    `discounted short margin (${totalShortLegMargin}) should be < 50% of raw (${totalShortLegRaw})`);
});

test('long straddle: zero discount but no exposure margin (long-only)', () => {
  const s = new SpanSim({ now: FIXED_NOW });
  const out = s.estimate({ legs: [
    niftyLeg({ side: 'BUY', type: 'CALL', strike: 25000 }),
    niftyLeg({ side: 'BUY', type: 'PUT',  strike: 25000 }),
  ]});
  assert.ok(out.spreads.some(sp => sp.type === 'long-straddle'));
  // Both legs are long, so exposure should be 0
  assert.equal(out.exposureMargin, 0);
});

test('short straddle: gets a ~50% discount', () => {
  const s = new SpanSim({ now: FIXED_NOW });
  const sumOfLegs = s.estimate({ legs: [
    niftyLeg({ side: 'SELL', type: 'CALL', strike: 25000 }),
  ]}).totalMargin + s.estimate({ legs: [
    niftyLeg({ side: 'SELL', type: 'PUT', strike: 25000 }),
  ]}).totalMargin;
  const straddle = s.estimate({ legs: [
    niftyLeg({ side: 'SELL', type: 'CALL', strike: 25000 }),
    niftyLeg({ side: 'SELL', type: 'PUT',  strike: 25000 }),
  ]});
  assert.ok(straddle.spreads.some(sp => sp.type === 'short-straddle'));
  assert.ok(straddle.totalMargin < sumOfLegs * 0.7,
    `expected ~50% discount, got straddle=${straddle.totalMargin} sumOfLegs=${sumOfLegs}`);
});

test('per-leg discount only counts the BEST spread (no double-counting)', () => {
  // An iron condor has 4 legs that ALSO form 2 vertical spreads. Each leg
  // should get exactly one discount (the iron-condor 0.75), not iron+vertical.
  const s = new SpanSim({ now: FIXED_NOW });
  const base = { symbol: 'NIFTY', expiry: '2026-06-25', qty: 1, lotSize: 25, spotPrice: 25000, iv: 0.18 };
  const out = s.estimate({ legs: [
    { ...base, type: 'PUT',  side: 'BUY',  strike: 24500 },
    { ...base, type: 'PUT',  side: 'SELL', strike: 24800 },
    { ...base, type: 'CALL', side: 'SELL', strike: 25200 },
    { ...base, type: 'CALL', side: 'BUY',  strike: 25500 },
  ]});
  for (const pl of out.perLeg) {
    assert.ok(pl.spanDiscount <= 0.75 + 1e-9, `leg ${pl.idx}: discount ${pl.spanDiscount} > 0.75`);
  }
});

// T-297a -- Holdings loader helper for the strategy selector.
//
// The covered-call template needs an array of user holdings in a specific
// shape: { symbol, qty, avgPrice, ltp }. The Zerodha broker returns rows
// in this shape already (see brokers/zerodha-broker.js getHoldings).
//
// This module is a thin pure helper that:
//   1. Normalises whatever the broker returns into the selector's shape
//   2. Filters out non-equity / non-ETF rows (we only sell calls against
//      shares we actually own -- options/futures positions don't count)
//   3. Filters out qty<=0 rows (short positions can't cover-call)
//
// Pure: no DB, no network, no broker calls. Caller fetches once and passes
// the array in. Used by services/options-scanner.js.

'use strict';

/**
 * @param {Array<object>} rawHoldings  rows from broker.getHoldings() or similar
 * @returns {Array<{symbol:string, qty:number, avgPrice:number, ltp:number}>}
 */
function normalizeHoldings(rawHoldings) {
  if (!Array.isArray(rawHoldings) || rawHoldings.length === 0) return [];
  const out = [];
  for (const h of rawHoldings) {
    if (!h || typeof h !== 'object') continue;
    const symbol = h.symbol || h.tradingsymbol;
    if (!symbol) continue;
    const qty = Number(h.quantity ?? h.qty);
    if (!Number.isFinite(qty) || qty <= 0) continue;
    const avgPrice = Number(h.avgPrice ?? h.average_price);
    const ltp = Number(h.ltp ?? h.last_price ?? avgPrice);
    if (!Number.isFinite(avgPrice) || avgPrice <= 0) continue;
    // Filter out option/future product types (we want underlying stock only)
    const product = h.product || '';
    if (product === 'MIS' || product === 'CO' || product === 'BO') continue;
    out.push({
      symbol: String(symbol).toUpperCase(),
      qty,
      avgPrice,
      ltp: Number.isFinite(ltp) ? ltp : avgPrice,
    });
  }
  return out;
}

/**
 * Fetch holdings for a user via their broker, normalised. Best-effort:
 * returns [] on any error (e.g. broker not connected, network failure).
 * @param {object} broker  resolved per-user broker instance
 * @returns {Promise<Array>}
 */
async function loadHoldingsFromBroker(broker) {
  if (!broker || typeof broker.getHoldings !== 'function') return [];
  try {
    const raw = await broker.getHoldings();
    return normalizeHoldings(raw);
  } catch {
    return [];
  }
}

// ---- Smoke tests ----

const SMOKE = () => {
  let pass = 0, fail = 0;
  const check = (lbl, c) => { if (c) { pass++; console.log('  PASS  ' + lbl); } else { fail++; console.log('  FAIL  ' + lbl); } };

  check('null -> []', normalizeHoldings(null).length === 0);
  check('[] -> []', normalizeHoldings([]).length === 0);

  // Kite native shape
  const kite = [
    { tradingsymbol: 'RELIANCE', quantity: 10, average_price: 2500, last_price: 2600, product: 'CNC' },
    { tradingsymbol: 'TCS',      quantity: 0,  average_price: 3000, last_price: 3100, product: 'CNC' },     // zero qty -> filtered
    { tradingsymbol: 'INFY',     quantity: 5,  average_price: 1500, last_price: 1550, product: 'MIS' },     // intraday -> filtered
    { tradingsymbol: 'NIFTYBEES', quantity: 100, average_price: 220, last_price: 230, product: 'CNC' },
  ];
  const n = normalizeHoldings(kite);
  check('kite shape: 2 holdings survive', n.length === 2);
  check('kite shape: RELIANCE present', n.some(h => h.symbol === 'RELIANCE'));
  check('kite shape: NIFTYBEES present', n.some(h => h.symbol === 'NIFTYBEES'));
  check('kite shape: TCS filtered (qty=0)', !n.some(h => h.symbol === 'TCS'));
  check('kite shape: INFY filtered (MIS)', !n.some(h => h.symbol === 'INFY'));
  check('kite shape: avgPrice numeric', Number.isFinite(n[0].avgPrice));
  check('kite shape: ltp numeric', Number.isFinite(n[0].ltp));

  // Already-normalised shape
  const already = [{ symbol: 'WIPRO', qty: 20, avgPrice: 400, ltp: 410 }];
  const n2 = normalizeHoldings(already);
  check('already-normalised: 1 row', n2.length === 1);
  check('already-normalised: WIPRO preserved', n2[0].symbol === 'WIPRO');

  // Broken row tolerance
  const broken = [
    null,
    undefined,
    { /* no symbol */ qty: 10, avgPrice: 100, ltp: 110 },
    { symbol: 'X', qty: 'banana', avgPrice: 100, ltp: 110 },           // non-numeric qty
    { symbol: 'Y', quantity: 5, average_price: -10, last_price: 20 },  // negative avg
    { symbol: 'GOOD', qty: 3, avgPrice: 50, ltp: 55 },                  // OK
  ];
  const n3 = normalizeHoldings(broken);
  check('broken rows: only GOOD survives', n3.length === 1 && n3[0].symbol === 'GOOD');

  // loadHoldingsFromBroker
  loadHoldingsFromBroker(null).then(r => {
    check('null broker -> []', r.length === 0);
    return loadHoldingsFromBroker({ getHoldings: async () => { throw new Error('boom'); } });
  }).then(r => {
    check('throwing broker -> []', r.length === 0);
    return loadHoldingsFromBroker({ getHoldings: async () => kite });
  }).then(r => {
    check('working broker -> normalised', r.length === 2);
    console.log('\nSmoke: ' + pass + ' pass, ' + fail + ' fail.');
    if (fail > 0) process.exit(1);
  });
};

if (require.main === module && process.argv.includes('--smoke')) {
  SMOKE();
}

module.exports = { normalizeHoldings, loadHoldingsFromBroker };

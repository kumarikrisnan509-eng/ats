// T-290a -- Option chain utilities (Phase 4 foundation, layer on top of T-294a).
//
// Pure functions. No Kite API calls, no storage, no scheduled fetches.
// This module is the LOGIC layer between Kite's raw instruments response
// and the rest of the engine:
//
//   parseKiteInstruments(rawInstruments, underlying, opts)
//     -> filter Kite's full NFO instrument dump to NIFTY/BANKNIFTY options,
//        normalise strike + expiry + type into a clean row shape.
//
//   enrichWithGreeks(chain, { spot, riskFreeRate, asOf })
//     -> attach delta/gamma/vega/theta to every row using Black-Scholes.
//        For IV, defers to row.iv if present (live), else falls back to
//        Newton-Raphson against row.ltp if present, else uses opts.assumedIV.
//
//   pickStrikeByDelta(chain, { type, targetDelta, expiry, side })
//     -> the Iron Condor / Bull Call Spread / strike-selection workhorse.
//        Returns the row whose computed Delta is closest to the target,
//        filtered to the requested type ('call'|'put') and expiry.
//
// What T-290 PROPER still needs (deferred):
//   - Live Kite Connect `instruments NFO` REST call + caching
//   - SQLite table option_chain (instrument_token, strike, expiry, type, ltp,
//     iv, oi, fetched_at) + scheduled refresh
//   - Server.js wiring + GET /api/me/option-chain/:underlying route
//
// Smoke tests at bottom; run via:
//   node deploy/backend/services/option-chain.js --smoke

'use strict';

const bs = require('./black-scholes');

// ---- Parsing ----

/**
 * Take Kite's raw instruments dump (an array of objects with fields like
 * tradingsymbol, instrument_token, strike, expiry, name, instrument_type,
 * segment, lot_size) and filter to the option chain for the given underlying.
 *
 * Underlying examples: 'NIFTY', 'BANKNIFTY', 'FINNIFTY'.
 * Kite uses `name` for the underlying and `segment` = 'NFO-OPT' for options.
 *
 * @param {Array} rawInstruments  Kite's response array (or test data)
 * @param {string} underlying     'NIFTY' | 'BANKNIFTY' | ...
 * @param {object} [opts]
 * @param {Date}   [opts.maxExpiry]  drop rows with expiry > this
 * @param {Date}   [opts.minExpiry]  drop rows with expiry < this (default: today)
 * @returns {Array<{symbol, instrumentToken, strike, expiry, type, lotSize}>}
 */
function parseKiteInstruments(rawInstruments, underlying, opts = {}) {
  if (!Array.isArray(rawInstruments)) return [];
  if (typeof underlying !== 'string' || !underlying.trim()) return [];
  const up = underlying.trim().toUpperCase();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const minExp = opts.minExpiry instanceof Date ? opts.minExpiry : today;
  const maxExp = opts.maxExpiry instanceof Date ? opts.maxExpiry : null;

  const out = [];
  for (const inst of rawInstruments) {
    if (!inst || typeof inst !== 'object') continue;
    if (String(inst.name || '').toUpperCase() !== up) continue;
    if (String(inst.segment || '').toUpperCase() !== 'NFO-OPT') continue;
    const t = String(inst.instrument_type || '').toUpperCase();
    if (t !== 'CE' && t !== 'PE') continue;

    const strike = Number(inst.strike);
    if (!Number.isFinite(strike) || strike <= 0) continue;

    // Kite returns expiry as 'YYYY-MM-DD' string in their API; tolerate
    // both string and Date.
    let expiryDate = null;
    if (inst.expiry instanceof Date) expiryDate = inst.expiry;
    else if (typeof inst.expiry === 'string') {
      const d = new Date(inst.expiry);
      if (!isNaN(d.getTime())) expiryDate = d;
    }
    if (!expiryDate) continue;
    if (expiryDate < minExp) continue;
    if (maxExp && expiryDate > maxExp) continue;

    out.push({
      symbol: String(inst.tradingsymbol || '').toUpperCase(),
      instrumentToken: Number(inst.instrument_token) || null,
      strike,
      expiry: expiryDate.toISOString().slice(0, 10),  // canonical YYYY-MM-DD
      type: t === 'CE' ? 'call' : 'put',
      lotSize: Number(inst.lot_size) || null,
    });
  }
  // Sort by (expiry, strike, type) for deterministic output
  out.sort((a, b) => {
    if (a.expiry !== b.expiry) return a.expiry < b.expiry ? -1 : 1;
    if (a.strike !== b.strike) return a.strike - b.strike;
    return a.type < b.type ? -1 : (a.type > b.type ? 1 : 0);
  });
  return out;
}

/**
 * Time to expiry in years from a 'YYYY-MM-DD' expiry string. Assumes 365-day
 * year. For India equity options that auto-square-off at 15:30 IST on expiry
 * day, we set the time-of-day to 15:30 IST.
 */
function _timeToExpiryYears(expiryStr, asOf) {
  const expiryDate = new Date(expiryStr + 'T15:30:00+05:30');
  const now = asOf instanceof Date ? asOf : new Date();
  const ms = expiryDate.getTime() - now.getTime();
  return Math.max(0, ms / (365 * 24 * 3600 * 1000));
}

// ---- Greeks enrichment ----

/**
 * Attach delta/gamma/vega/theta to each row of a parsed chain.
 *
 * For each row:
 *   - T (years) computed from row.expiry vs asOf (default: now)
 *   - sigma:
 *       1. row.iv if present and finite (treat as decimal, e.g. 0.18)
 *       2. else: invert row.ltp via Newton-Raphson (impliedVol)
 *       3. else: opts.assumedIV (default 0.18)
 *
 * Returns a new array; does not mutate inputs.
 *
 * @param {Array} chain         output of parseKiteInstruments + maybe ltp/iv
 * @param {object} opts
 * @param {number} opts.spot           underlying spot price
 * @param {number} opts.riskFreeRate   decimal, default 0.07 (India 10Y G-Sec)
 * @param {Date}   [opts.asOf]         default: now
 * @param {number} [opts.assumedIV]    fallback when ltp+iv both missing; default 0.18
 */
function enrichWithGreeks(chain, opts = {}) {
  if (!Array.isArray(chain)) return [];
  const spot = Number(opts.spot);
  if (!Number.isFinite(spot) || spot <= 0) {
    throw new Error('enrichWithGreeks: opts.spot must be > 0');
  }
  const r = Number.isFinite(opts.riskFreeRate) ? opts.riskFreeRate : 0.07;
  const assumedIV = Number.isFinite(opts.assumedIV) ? opts.assumedIV : 0.18;
  const asOf = opts.asOf instanceof Date ? opts.asOf : new Date();

  return chain.map(row => {
    const T = _timeToExpiryYears(row.expiry, asOf);
    if (T <= 0) {
      // At/after expiry: intrinsic only
      return { ...row, greeks: null, ivUsed: null, T: 0, ivSource: 'expired' };
    }

    let sigma = null, ivSource = null;
    if (Number.isFinite(row.iv) && row.iv > 0 && row.iv < 5) {
      sigma = row.iv;
      ivSource = 'provided';
    } else if (Number.isFinite(row.ltp) && row.ltp > 0) {
      const recovered = bs.impliedVol(row.ltp, spot, row.strike, T, r, row.type);
      if (recovered != null) {
        sigma = recovered;
        ivSource = 'inverted';
      }
    }
    if (sigma == null) {
      sigma = assumedIV;
      ivSource = 'assumed';
    }

    let g = null;
    try {
      g = bs.greeks(spot, row.strike, T, r, sigma, row.type);
    } catch (_e) { g = null; }

    return {
      ...row,
      T: _roundTo(T, 6),
      ivUsed: _roundTo(sigma, 4),
      ivSource,
      greeks: g ? {
        price: _roundTo(g.price, 2),
        delta: _roundTo(g.delta, 4),
        gamma: _roundTo(g.gamma, 6),
        vega:  _roundTo(g.vega, 2),
        theta: _roundTo(g.theta, 2),
        rho:   _roundTo(g.rho, 2),
      } : null,
    };
  });
}

// ---- Strike picker (the Iron Condor / spreads workhorse) ----

/**
 * Pick the row whose computed Delta is closest to the target.
 *
 * Use cases:
 *   - Iron Condor short legs: pickStrikeByDelta(chain, { type:'call', targetDelta: 0.15, expiry })
 *   - Iron Condor long protective: { type:'call', targetDelta: 0.05 }  (further OTM)
 *   - Bull Call Spread buy leg:    { type:'call', targetDelta: 0.50 }  (ATM)
 *   - Bull Call Spread sell leg:   { type:'call', targetDelta: 0.30 }
 *   - Covered Call:                { type:'call', targetDelta: 0.25 }
 *
 * @param {Array} chain    output of enrichWithGreeks (rows must have .greeks.delta)
 * @param {object} opts
 * @param {string} opts.type        'call' | 'put'
 * @param {number} opts.targetDelta absolute value of target delta (0..1)
 * @param {string} [opts.expiry]    YYYY-MM-DD; if set, filter to this expiry
 * @returns {object|null}  the row with closest delta, or null if none match
 */
function pickStrikeByDelta(chain, opts = {}) {
  if (!Array.isArray(chain)) return null;
  const type = opts.type;
  const target = Number(opts.targetDelta);
  if (type !== 'call' && type !== 'put') throw new Error("pickStrikeByDelta: type must be 'call' or 'put'");
  if (!Number.isFinite(target) || target < 0 || target > 1) throw new Error('pickStrikeByDelta: targetDelta must be in [0, 1]');

  const expiry = opts.expiry;
  let best = null;
  let bestDiff = Infinity;
  for (const row of chain) {
    if (row.type !== type) continue;
    if (expiry && row.expiry !== expiry) continue;
    if (!row.greeks || !Number.isFinite(row.greeks.delta)) continue;
    const absDelta = Math.abs(row.greeks.delta);
    const diff = Math.abs(absDelta - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = row;
    }
  }
  return best;
}

/**
 * Convenience: list all distinct expiries in a chain, sorted ascending.
 */
function expiries(chain) {
  if (!Array.isArray(chain)) return [];
  const set = new Set();
  for (const row of chain) if (row.expiry) set.add(row.expiry);
  return Array.from(set).sort();
}

// ---- Helpers ----

function _roundTo(n, places) {
  const m = Math.pow(10, places);
  return Math.round(n * m) / m;
}

// ---- Smoke tests ----

const SMOKE_TESTS = () => {
  // Synthesize a minimal NIFTY weekly chain (Thu expiry, 7 days out).
  const today = new Date('2026-05-21T10:00:00+05:30');
  const expiry = new Date(today.getTime() + 7 * 24 * 3600 * 1000);
  const expiryStr = expiry.toISOString().slice(0, 10);

  const raw = [];
  // 5 strikes around 24500 spot, both call + put
  for (const k of [24300, 24400, 24500, 24600, 24700]) {
    raw.push({
      name: 'NIFTY', segment: 'NFO-OPT', instrument_type: 'CE',
      tradingsymbol: `NIFTY${expiryStr.replace(/-/g,'')}${k}CE`,
      instrument_token: 1000000 + k, strike: k, expiry: expiryStr, lot_size: 75,
    });
    raw.push({
      name: 'NIFTY', segment: 'NFO-OPT', instrument_type: 'PE',
      tradingsymbol: `NIFTY${expiryStr.replace(/-/g,'')}${k}PE`,
      instrument_token: 2000000 + k, strike: k, expiry: expiryStr, lot_size: 75,
    });
  }
  // Add some noise rows to verify filtering works
  raw.push({ name: 'RELIANCE', segment: 'NSE', instrument_type: 'EQ', strike: 2800, expiry: expiryStr }); // wrong segment
  raw.push({ name: 'BANKNIFTY', segment: 'NFO-OPT', instrument_type: 'CE', strike: 50000, expiry: expiryStr, tradingsymbol: 'BN-CE', instrument_token: 9, lot_size: 15 }); // wrong underlying

  const parsed = parseKiteInstruments(raw, 'NIFTY', { asOf: today });
  const expected = 10;  // 5 strikes x 2 types
  const test1 = parsed.length === expected;
  console.log(`  ${test1 ? 'PASS' : 'FAIL'}  parser filters to ${parsed.length} rows (expected ${expected})`);

  // All rows should be NIFTY, not BANKNIFTY/RELIANCE
  const test2 = parsed.every(r => r.symbol.startsWith('NIFTY'));
  console.log(`  ${test2 ? 'PASS' : 'FAIL'}  all parsed rows are NIFTY`);

  // Enrich with Greeks at spot=24500, sigma=0.13 (typical India VIX)
  const enriched = enrichWithGreeks(parsed, { spot: 24500, riskFreeRate: 0.07, asOf: today, assumedIV: 0.13 });
  const test3 = enriched.length === expected && enriched.every(r => r.greeks && Number.isFinite(r.greeks.delta));
  console.log(`  ${test3 ? 'PASS' : 'FAIL'}  Greeks attached to all ${enriched.length} rows`);

  // ATM call (K=24500) should have delta close to 0.5
  const atmCall = enriched.find(r => r.strike === 24500 && r.type === 'call');
  const test4 = atmCall && Math.abs(atmCall.greeks.delta - 0.5) < 0.05;
  console.log(`  ${test4 ? 'PASS' : 'FAIL'}  ATM call delta ≈ 0.5 (got ${atmCall && atmCall.greeks.delta})`);

  // Deep OTM call (K=24700) should have lower delta than ATM
  const otmCall = enriched.find(r => r.strike === 24700 && r.type === 'call');
  const test5 = otmCall && otmCall.greeks.delta < atmCall.greeks.delta;
  console.log(`  ${test5 ? 'PASS' : 'FAIL'}  OTM call delta < ATM call delta (${otmCall && otmCall.greeks.delta} < ${atmCall.greeks.delta})`);

  // Picker: target delta 0.30 for calls should pick something OTM
  const pick30 = pickStrikeByDelta(enriched, { type: 'call', targetDelta: 0.30 });
  const test6 = pick30 && pick30.strike >= 24500;
  console.log(`  ${test6 ? 'PASS' : 'FAIL'}  pickStrikeByDelta(call, 0.30) picked K=${pick30 && pick30.strike}`);

  // Picker: target delta 0.50 should pick ATM-ish
  const pick50 = pickStrikeByDelta(enriched, { type: 'call', targetDelta: 0.50 });
  const test7 = pick50 && Math.abs(pick50.strike - 24500) <= 100;
  console.log(`  ${test7 ? 'PASS' : 'FAIL'}  pickStrikeByDelta(call, 0.50) picked K=${pick50 && pick50.strike}`);

  // Expiries helper
  const exps = expiries(enriched);
  const test8 = exps.length === 1 && exps[0] === expiryStr;
  console.log(`  ${test8 ? 'PASS' : 'FAIL'}  expiries() returns [${exps.join(',')}]`);

  const results = [test1, test2, test3, test4, test5, test6, test7, test8];
  const pass = results.filter(Boolean).length;
  const fail = results.length - pass;
  console.log(`\nSmoke: ${pass} pass, ${fail} fail.`);
  if (fail > 0) process.exit(1);
};

if (require.main === module && process.argv.includes('--smoke')) {
  SMOKE_TESTS();
}

module.exports = {
  parseKiteInstruments,
  enrichWithGreeks,
  pickStrikeByDelta,
  expiries,
  // testing exports
  _timeToExpiryYears,
};

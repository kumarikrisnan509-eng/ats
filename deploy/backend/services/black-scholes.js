// T-294a -- Black-Scholes options-pricing math module (Phase 4 foundation).
//
// Pure functions. No state. No engine integration. Future tickets (T-290
// option chain ingestion, T-291..T-293 options strategies, T-294 portfolio
// Greeks integration) build on this.
//
// Conventions:
//   S      = spot price of underlying (e.g. NIFTY = 24500)
//   K      = strike price
//   T      = time to expiry in YEARS (e.g. 7 days = 7/365)
//   r      = risk-free rate as decimal (India 10Y G-Sec, current ~0.07)
//   sigma  = annualised volatility as decimal (e.g. India VIX 15 = 0.15)
//   type   = 'call' | 'put'
//
// Outputs:
//   price  in INR (same currency as S and K)
//   delta  ∂price/∂S        (range: 0..1 for calls, -1..0 for puts)
//   gamma  ∂²price/∂S²      (always positive for long options)
//   vega   ∂price/∂sigma per 1.0 change in sigma (i.e. raw; divide by 100
//          to get \"per 1% vol change\" which is the trader convention)
//   theta  ∂price/∂T per YEAR (divide by 365 for per-day decay)
//   rho    ∂price/∂r per 1.0 change in r
//
// Smoke-tested against Hull's textbook example (S=42, K=40, T=0.5, r=0.10,
// sigma=0.20 -> call price ≈ 4.7594, put price ≈ 0.8086) -- see SMOKE_TESTS
// block at the bottom of this file. Verify with `node deploy/backend/services/
// black-scholes.js --smoke`.
//
// Public API:
//   const bs = require('./services/black-scholes');
//   bs.price(S, K, T, r, sigma, type)
//   bs.greeks(S, K, T, r, sigma, type) -> { price, delta, gamma, vega, theta, rho }
//   bs.impliedVol(marketPrice, S, K, T, r, type) -> sigma (Newton-Raphson)

'use strict';

// ---- Math primitives (no external deps) ----

/**
 * Standard normal cumulative distribution function.
 * Abramowitz & Stegun 7.1.26 approximation. Accurate to ~7.5e-8 across the
 * full real line -- more than enough for options pricing.
 */
function _cdf(x) {
  const a1 =  0.254829592;
  const a2 = -0.284496736;
  const a3 =  1.421413741;
  const a4 = -1.453152027;
  const a5 =  1.061405429;
  const p  =  0.3275911;

  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x) / Math.sqrt(2);
  const t = 1.0 / (1.0 + p * ax);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-ax * ax);
  return 0.5 * (1.0 + sign * y);
}

/**
 * Standard normal probability density function.
 */
function _pdf(x) {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// ---- Validation ----

function _validate(S, K, T, r, sigma, type) {
  if (!Number.isFinite(S) || S <= 0) throw new Error('S must be > 0');
  if (!Number.isFinite(K) || K <= 0) throw new Error('K must be > 0');
  if (!Number.isFinite(T) || T < 0)  throw new Error('T must be >= 0 (years)');
  if (!Number.isFinite(r))           throw new Error('r must be a number');
  if (!Number.isFinite(sigma) || sigma <= 0) throw new Error('sigma must be > 0');
  if (type !== 'call' && type !== 'put') throw new Error("type must be 'call' or 'put'");
}

// ---- d1, d2 ----

function _d1(S, K, T, r, sigma) {
  return (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
}
function _d2(d1, sigma, T) {
  return d1 - sigma * Math.sqrt(T);
}

// ---- Price ----

function price(S, K, T, r, sigma, type) {
  _validate(S, K, T, r, sigma, type);
  // Degenerate at-expiry case
  if (T === 0) {
    return type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
  }
  const d1 = _d1(S, K, T, r, sigma);
  const d2 = _d2(d1, sigma, T);
  if (type === 'call') {
    return S * _cdf(d1) - K * Math.exp(-r * T) * _cdf(d2);
  } else {
    return K * Math.exp(-r * T) * _cdf(-d2) - S * _cdf(-d1);
  }
}

// ---- Greeks (single call returns all five + price) ----

function greeks(S, K, T, r, sigma, type) {
  _validate(S, K, T, r, sigma, type);
  if (T === 0) {
    // At expiry: delta is 0/1, gamma/vega/theta/rho collapse.
    const intrinsic = type === 'call' ? Math.max(S - K, 0) : Math.max(K - S, 0);
    const itm = type === 'call' ? (S > K) : (K > S);
    return {
      price: intrinsic,
      delta: itm ? (type === 'call' ? 1 : -1) : 0,
      gamma: 0, vega: 0, theta: 0, rho: 0,
    };
  }
  const d1 = _d1(S, K, T, r, sigma);
  const d2 = _d2(d1, sigma, T);
  const sqrtT = Math.sqrt(T);

  let priceVal, deltaVal, thetaVal, rhoVal;
  if (type === 'call') {
    priceVal = S * _cdf(d1) - K * Math.exp(-r * T) * _cdf(d2);
    deltaVal = _cdf(d1);
    // Theta per YEAR (negative for long options).
    thetaVal = -(S * _pdf(d1) * sigma) / (2 * sqrtT)
               - r * K * Math.exp(-r * T) * _cdf(d2);
    rhoVal   = K * T * Math.exp(-r * T) * _cdf(d2);
  } else {
    priceVal = K * Math.exp(-r * T) * _cdf(-d2) - S * _cdf(-d1);
    deltaVal = _cdf(d1) - 1;
    thetaVal = -(S * _pdf(d1) * sigma) / (2 * sqrtT)
               + r * K * Math.exp(-r * T) * _cdf(-d2);
    rhoVal   = -K * T * Math.exp(-r * T) * _cdf(-d2);
  }
  // gamma and vega are identical for calls and puts.
  const gammaVal = _pdf(d1) / (S * sigma * sqrtT);
  const vegaVal  = S * _pdf(d1) * sqrtT;

  return {
    price: priceVal,
    delta: deltaVal,
    gamma: gammaVal,
    vega:  vegaVal,
    theta: thetaVal,
    rho:   rhoVal,
  };
}

// ---- Implied volatility (Newton-Raphson) ----

/**
 * Recover sigma from observed market price. Uses Newton-Raphson with vega
 * as the derivative. Initial guess: 0.20 (20%, typical India equity vol).
 * Bails after 50 iterations or when |residual| < 1e-6.
 * Returns null if the solver doesn't converge (extreme cases like deep-ITM
 * or near-zero-time-value).
 */
function impliedVol(marketPrice, S, K, T, r, type) {
  if (!Number.isFinite(marketPrice) || marketPrice <= 0) return null;
  if (!Number.isFinite(S) || S <= 0) return null;
  if (!Number.isFinite(K) || K <= 0) return null;
  if (!Number.isFinite(T) || T <= 0) return null;
  if (!Number.isFinite(r))           return null;
  if (type !== 'call' && type !== 'put') return null;

  // Intrinsic value floor: market price below intrinsic is impossible /
  // arbitrageable; IV undefined.
  const intrinsic = type === 'call' ? Math.max(S - K * Math.exp(-r * T), 0)
                                    : Math.max(K * Math.exp(-r * T) - S, 0);
  if (marketPrice < intrinsic - 0.01) return null;

  let sigma = 0.20;
  const maxIter = 50;
  const tol = 1e-6;

  for (let i = 0; i < maxIter; i++) {
    const g = greeks(S, K, T, r, sigma, type);
    const diff = g.price - marketPrice;
    if (Math.abs(diff) < tol) return sigma;
    if (!Number.isFinite(g.vega) || g.vega < 1e-10) return null;
    sigma = sigma - diff / g.vega;
    // Keep sigma in a sane range; if it diverges, abandon.
    if (sigma <= 0.001) sigma = 0.001;
    if (sigma > 5.0)    return null;
  }
  return null; // didn't converge
}

// ---- Convenience: trader-friendly Greek normalisations ----

/**
 * Wraps greeks() with the per-day theta + per-1%-vol vega the trading
 * desk typically displays. Use this if you're surfacing Greeks to the UI;
 * use raw greeks() if you're composing into other math.
 */
function greeksDesk(S, K, T, r, sigma, type) {
  const g = greeks(S, K, T, r, sigma, type);
  return {
    price:    g.price,
    delta:    g.delta,
    gamma:    g.gamma,
    vegaPer1pct:   g.vega / 100,    // INR change per 1% vol change
    thetaPerDay:   g.theta / 365,   // INR decay per calendar day
    rhoPer1pct:    g.rho / 100,
  };
}

// ---- Smoke test runner (node black-scholes.js --smoke) ----

const SMOKE_TESTS = [
  // Hull, "Options, Futures, and Other Derivatives" 9th ed., p.359 example:
  // S=42, K=40, T=0.5, r=0.10, sigma=0.20 -> call price ≈ 4.7594
  {
    label: 'Hull p.359 call',
    args: { S: 42, K: 40, T: 0.5, r: 0.10, sigma: 0.20, type: 'call' },
    expectPrice: 4.7594, tol: 0.001,
  },
  {
    label: 'Hull p.359 put (parity)',
    args: { S: 42, K: 40, T: 0.5, r: 0.10, sigma: 0.20, type: 'put' },
    // Put-call parity: P = C - S + K*exp(-rT) = 4.7594 - 42 + 40*exp(-0.05)
    //                = 4.7594 - 42 + 38.0492 = 0.8086
    expectPrice: 0.8086, tol: 0.001,
  },
  // ATM 1-month call, low vol — sanity for typical India weekly option
  // S=24500, K=24500, T=7/365, r=0.07, sigma=0.13 ≈ 0.15 (typical India VIX)
  // Expected call price ≈ 0.5 * S * sigma * sqrt(T) ≈ 0.5 * 24500 * 0.13 * 0.138
  // ≈ 220. Smoke: should be in [180, 260].
  {
    label: 'NIFTY ATM weekly (smoke band)',
    args: { S: 24500, K: 24500, T: 7/365, r: 0.07, sigma: 0.13, type: 'call' },
    expectBand: [150, 280],
  },
  // Put-call parity sanity: P + S = C + K*exp(-rT)
  // For S=100, K=100, T=0.25, r=0.05, sigma=0.20 we get C ≈ 4.6147, P ≈ 3.3724
  {
    label: 'ATM 3M r=0.05 call',
    args: { S: 100, K: 100, T: 0.25, r: 0.05, sigma: 0.20, type: 'call' },
    expectPrice: 4.6147, tol: 0.001,
  },
  {
    label: 'ATM 3M r=0.05 put',
    args: { S: 100, K: 100, T: 0.25, r: 0.05, sigma: 0.20, type: 'put' },
    expectPrice: 3.3724, tol: 0.001,
  },
];

function _runSmoke() {
  let pass = 0, fail = 0;
  for (const t of SMOKE_TESTS) {
    const { S, K, T, r, sigma, type } = t.args;
    const g = greeks(S, K, T, r, sigma, type);
    let ok = false;
    if (t.expectPrice != null) {
      ok = Math.abs(g.price - t.expectPrice) < (t.tol || 0.01);
    } else if (t.expectBand) {
      ok = g.price >= t.expectBand[0] && g.price <= t.expectBand[1];
    }
    if (ok) { pass++; console.log(`  PASS  ${t.label}  price=${g.price.toFixed(4)}`); }
    else    { fail++; console.log(`  FAIL  ${t.label}  price=${g.price.toFixed(4)}, expected ${t.expectPrice || t.expectBand}`); }
  }
  // IV round-trip: price -> impliedVol -> should recover the original sigma
  const iv = impliedVol(4.6147, 100, 100, 0.25, 0.05, 'call');
  if (iv != null && Math.abs(iv - 0.20) < 0.001) { pass++; console.log(`  PASS  IV round-trip (0.20 -> ${iv.toFixed(4)})`); }
  else { fail++; console.log(`  FAIL  IV round-trip (got ${iv})`); }

  console.log(`\nSmoke: ${pass} pass, ${fail} fail.`);
  if (fail > 0) process.exit(1);
}

if (require.main === module && process.argv.includes('--smoke')) {
  _runSmoke();
}

module.exports = {
  price,
  greeks,
  greeksDesk,
  impliedVol,
  // Exposed for testing only
  _cdf, _pdf, _d1, _d2,
};

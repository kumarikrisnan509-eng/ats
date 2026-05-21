// T-296a CI tests -- mirrors --smoke assertions in services/black-scholes.js
// against Hull's textbook reference inputs.

'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const bs = require('../services/black-scholes');

// Hull textbook example (8th ed): S=42, K=40, T=0.5, r=0.10, sigma=0.20
//   call = 4.7594, put = 0.8086
const S = 42, K = 40, T = 0.5, r = 0.10, sigma = 0.20;

test('price() matches Hull example for call within 0.001', () => {
  const c = bs.price(S, K, T, r, sigma, 'call');
  assert.ok(Math.abs(c - 4.7594) < 0.001, `call=${c}, expected ~4.7594`);
});

test('price() matches Hull example for put within 0.001', () => {
  const p = bs.price(S, K, T, r, sigma, 'put');
  assert.ok(Math.abs(p - 0.8086) < 0.001, `put=${p}, expected ~0.8086`);
});

test('put-call parity holds: C - P = S - K*exp(-rT)', () => {
  const c = bs.price(S, K, T, r, sigma, 'call');
  const p = bs.price(S, K, T, r, sigma, 'put');
  const lhs = c - p;
  const rhs = S - K * Math.exp(-r * T);
  assert.ok(Math.abs(lhs - rhs) < 1e-6, `parity diff=${lhs - rhs}`);
});

test('greeks() returns finite delta/gamma/vega/theta/rho', () => {
  const g = bs.greeks(S, K, T, r, sigma, 'call');
  for (const k of ['delta', 'gamma', 'vega', 'theta', 'rho', 'price']) {
    assert.ok(Number.isFinite(g[k]), `${k}=${g[k]} not finite`);
  }
});

test('call delta in (0, 1), put delta in (-1, 0)', () => {
  const c = bs.greeks(S, K, T, r, sigma, 'call');
  const p = bs.greeks(S, K, T, r, sigma, 'put');
  assert.ok(c.delta > 0 && c.delta < 1, `call delta=${c.delta}`);
  assert.ok(p.delta < 0 && p.delta > -1, `put delta=${p.delta}`);
});

test('impliedVol() recovers input sigma round-trip', () => {
  const callPrice = bs.price(S, K, T, r, sigma, 'call');
  const recovered = bs.impliedVol(callPrice, S, K, T, r, 'call');
  assert.ok(Math.abs(recovered - sigma) < 1e-4,
    `iv=${recovered}, expected ${sigma}`);
});

test('validation: zero/negative S throws', () => {
  assert.throws(() => bs.price(0, K, T, r, sigma, 'call'), /S must be > 0/);
  assert.throws(() => bs.price(-1, K, T, r, sigma, 'call'), /S must be > 0/);
});

test('validation: invalid option type throws', () => {
  assert.throws(() => bs.price(S, K, T, r, sigma, 'banana'), /call.*put/);
});

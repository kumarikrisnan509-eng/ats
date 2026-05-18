// promotion-rate.test.js — T-159 regression guard for promotion-rate.js.
//
// computePromotionRate powers the Signals screen's Paper→Live rate tile.
// A regression in the threshold logic silently flips which paper trades
// look "ready to promote" — could over-encourage premature live trading.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computePromotionRate, DEFAULT_MIN_TRADES } = require('../promotion-rate');

// ---------- module shape ----------

test('exports computePromotionRate + DEFAULT_MIN_TRADES', () => {
  assert.equal(typeof computePromotionRate, 'function');
  assert.equal(typeof DEFAULT_MIN_TRADES, 'number');
  assert.ok(DEFAULT_MIN_TRADES >= 1);
});

// ---------- empty inputs ----------

test('computePromotionRate: empty/null/undefined → zero summary', () => {
  for (const inp of [[], null, undefined]) {
    const r = computePromotionRate(inp);
    assert.equal(r.total_groups, 0);
    assert.equal(r.ready_groups, 0);
    assert.equal(r.rate, 0);
    assert.equal(r.total_trades, 0);
    assert.deepEqual(r.groups, []);
  }
});

test('computePromotionRate: rows with missing symbol or non-finite pnl dropped', () => {
  const r = computePromotionRate([
    { symbol: 'TCS', strategy_tag: 'rsi', pnl: 100, exited_at: '2026-05-01' },
    { symbol: '',    strategy_tag: 'rsi', pnl: 100 },          // dropped (no symbol)
    { symbol: 'INFY', pnl: NaN },                              // dropped (bad pnl)
    { strategy_tag: 'rsi', pnl: 100 },                         // dropped (no symbol)
    { symbol: 'TCS', strategy_tag: 'rsi', pnl: 200, exited_at: '2026-05-02' },
  ]);
  assert.equal(r.total_trades, 2);
  assert.equal(r.total_groups, 1);
});

// ---------- grouping ----------

test('computePromotionRate: groups by (symbol, strategy_tag)', () => {
  const r = computePromotionRate([
    { symbol: 'TCS',  strategy_tag: 'rsi',     pnl: 100 },
    { symbol: 'TCS',  strategy_tag: 'rsi',     pnl: 200 },
    { symbol: 'TCS',  strategy_tag: 'macd',    pnl: 50 },     // different strategy → different group
    { symbol: 'INFY', strategy_tag: 'rsi',     pnl: -100 },   // different symbol
  ]);
  assert.equal(r.total_groups, 3);
  assert.equal(r.total_trades, 4);
});

test('computePromotionRate: null strategy maps to "untagged"', () => {
  const r = computePromotionRate([
    { symbol: 'TCS', strategy_tag: null, pnl: 100 },
    { symbol: 'TCS', strategy_tag: null, pnl: 200 },
  ]);
  assert.equal(r.total_groups, 1);
  assert.equal(r.groups[0].strategy, null);
});

test('computePromotionRate: symbol is uppercased for grouping', () => {
  const r = computePromotionRate([
    { symbol: 'TCS', strategy_tag: 'rsi', pnl: 100 },
    { symbol: 'tcs', strategy_tag: 'rsi', pnl: 200 },
  ]);
  assert.equal(r.total_groups, 1);
  assert.equal(r.groups[0].trades, 2);
});

// ---------- ready / not-ready threshold ----------

test('computePromotionRate: group with >=5 trades is ready (default threshold)', () => {
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push({ symbol: 'TCS', strategy_tag: 'rsi', pnl: 100 });
  const r = computePromotionRate(rows);
  assert.equal(r.total_groups, 1);
  assert.equal(r.ready_groups, 1);
  assert.equal(r.rate, 1.0);
  assert.equal(r.groups[0].ready, true);
});

test('computePromotionRate: group with 4 trades is NOT ready', () => {
  const rows = [];
  for (let i = 0; i < 4; i++) rows.push({ symbol: 'TCS', strategy_tag: 'rsi', pnl: 100 });
  const r = computePromotionRate(rows);
  assert.equal(r.ready_groups, 0);
  assert.equal(r.rate, 0);
  assert.equal(r.groups[0].ready, false);
});

test('computePromotionRate: minTrades override changes threshold', () => {
  const rows = [];
  for (let i = 0; i < 3; i++) rows.push({ symbol: 'TCS', strategy_tag: 'rsi', pnl: 100 });
  const lenient = computePromotionRate(rows, { minTrades: 3 });
  assert.equal(lenient.ready_groups, 1);
  assert.equal(lenient.rate, 1.0);
  const strict = computePromotionRate(rows, { minTrades: 10 });
  assert.equal(strict.ready_groups, 0);
  assert.equal(strict.rate, 0);
});

test('computePromotionRate: rate is ready_groups / total_groups', () => {
  // 2 of 4 groups have >=5 trades
  const rows = [];
  for (let i = 0; i < 5; i++) rows.push({ symbol: 'A', strategy_tag: 's', pnl: 100 });
  for (let i = 0; i < 5; i++) rows.push({ symbol: 'B', strategy_tag: 's', pnl: 100 });
  rows.push({ symbol: 'C', strategy_tag: 's', pnl: 100 });
  rows.push({ symbol: 'D', strategy_tag: 's', pnl: 100 });
  const r = computePromotionRate(rows);
  assert.equal(r.total_groups, 4);
  assert.equal(r.ready_groups, 2);
  assert.equal(r.rate, 0.5);
});

// ---------- per-group metrics ----------

test('computePromotionRate: per-group wins + win_rate + net_pnl', () => {
  const r = computePromotionRate([
    { symbol: 'TCS', strategy_tag: 'rsi', pnl: 100 },
    { symbol: 'TCS', strategy_tag: 'rsi', pnl: 200 },
    { symbol: 'TCS', strategy_tag: 'rsi', pnl: -50 },
    { symbol: 'TCS', strategy_tag: 'rsi', pnl: 0 },         // breakeven, not a win
  ]);
  const g = r.groups[0];
  assert.equal(g.trades, 4);
  assert.equal(g.wins, 2);
  assert.equal(g.win_rate, 0.5);
  assert.equal(g.net_pnl, 250);
});

test('computePromotionRate: net_pnl rounded to 2dp', () => {
  const r = computePromotionRate([
    { symbol: 'TCS', strategy_tag: 'rsi', pnl: 100.1234 },
    { symbol: 'TCS', strategy_tag: 'rsi', pnl: 50.5678 },
  ]);
  assert.equal(r.groups[0].net_pnl, 150.69);
});

// ---------- sorting ----------

test('computePromotionRate: groups sorted with ready-first, then trades-desc, then symbol asc', () => {
  const rows = [
    { symbol: 'Z', strategy_tag: 's', pnl: 1 },   // 1 trade, not ready
    ...Array(5).fill({ symbol: 'B', strategy_tag: 's', pnl: 1 }),  // 5 trades, ready
    ...Array(6).fill({ symbol: 'A', strategy_tag: 's', pnl: 1 }),  // 6 trades, ready
    ...Array(3).fill({ symbol: 'C', strategy_tag: 's', pnl: 1 }),  // 3 trades, not ready
  ];
  const r = computePromotionRate(rows);
  // First two groups must be ready, ordered by trade count desc
  assert.equal(r.groups[0].symbol, 'A');
  assert.equal(r.groups[0].ready, true);
  assert.equal(r.groups[1].symbol, 'B');
  assert.equal(r.groups[1].ready, true);
  // Then not-ready, by trade count desc
  assert.equal(r.groups[2].symbol, 'C');
  assert.equal(r.groups[2].ready, false);
  assert.equal(r.groups[3].symbol, 'Z');
});

test('computePromotionRate: alphabetical tiebreaker when ready + trades equal', () => {
  const rows = [
    ...Array(5).fill({ symbol: 'TCS',  strategy_tag: 's', pnl: 1 }),
    ...Array(5).fill({ symbol: 'INFY', strategy_tag: 's', pnl: 1 }),
  ];
  const r = computePromotionRate(rows);
  // Both ready + same trade count → alphabetical
  assert.equal(r.groups[0].symbol, 'INFY');
  assert.equal(r.groups[1].symbol, 'TCS');
});

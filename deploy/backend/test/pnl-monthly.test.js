// pnl-monthly.test.js — T-156 regression guard for pnl-monthly.js.
//
// The aggregator is the foundation that will unblock AI Review's currently-
// gated KPIs (T-136/T-139 wrapped them in MockData.isDemoOn()). When the
// frontend rewires to /api/me/pnl/monthly, these numbers go LIVE — so a
// regression here directly mis-states real user PnL.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { monthBucket, aggregateMonthly, summarize } = require('../pnl-monthly');

// ---------- monthBucket ----------

test('monthBucket extracts YYYY-MM from ISO timestamps', () => {
  assert.equal(monthBucket('2026-05-18T03:42:00.000Z'), '2026-05');
  assert.equal(monthBucket('2026-12-31T23:59:59Z'), '2026-12');
  assert.equal(monthBucket('2025-01-01T00:00:00Z'), '2025-01');
});

test('monthBucket extracts YYYY-MM from SQLite datetime() format', () => {
  // datetime() default format: 'YYYY-MM-DD HH:MM:SS'
  assert.equal(monthBucket('2026-05-18 03:42:00'), '2026-05');
  assert.equal(monthBucket('2024-02-29 12:00:00'), '2024-02');
});

test('monthBucket returns null for malformed inputs', () => {
  assert.equal(monthBucket(''), null);
  assert.equal(monthBucket(null), null);
  assert.equal(monthBucket(undefined), null);
  assert.equal(monthBucket('not a date'), null);
  assert.equal(monthBucket('20260518'), null);
  assert.equal(monthBucket('05-2026'), null);     // wrong order
  assert.equal(monthBucket('YYYY-MM'), null);     // not digits
});

// ---------- aggregateMonthly: empty inputs ----------

test('aggregateMonthly returns [] for empty/null input', () => {
  assert.deepEqual(aggregateMonthly([]), []);
  assert.deepEqual(aggregateMonthly(null), []);
  assert.deepEqual(aggregateMonthly(undefined), []);
});

test('aggregateMonthly filters out rows with non-finite pnl or missing date', () => {
  const rows = [
    { pnl: 100, exited_at: '2026-05-01 10:00:00' },
    { pnl: NaN, exited_at: '2026-05-02 10:00:00' },       // dropped
    { pnl: 200 },                                          // missing date
    { pnl: 300, exited_at: '2026-05-03 10:00:00' },
  ];
  const r = aggregateMonthly(rows);
  assert.equal(r.length, 1);
  assert.equal(r[0].trades, 2);
  assert.equal(r[0].net_pnl, 400);
});

// ---------- aggregateMonthly: single month ----------

test('aggregateMonthly net_pnl is the sum of pnl in the month', () => {
  const r = aggregateMonthly([
    { pnl:  500, exited_at: '2026-05-01 10:00:00' },
    { pnl: -200, exited_at: '2026-05-02 10:00:00' },
    { pnl:  100, exited_at: '2026-05-03 10:00:00' },
  ]);
  assert.equal(r.length, 1);
  assert.equal(r[0].month, '2026-05');
  assert.equal(r[0].net_pnl, 400);
  assert.equal(r[0].trades, 3);
  assert.equal(r[0].wins, 2);
  assert.equal(r[0].losses, 1);
  assert.equal(r[0].win_rate, 0.6667);
});

test('aggregateMonthly: zero-pnl trades count toward trades but not wins/losses', () => {
  const r = aggregateMonthly([
    { pnl:  500, exited_at: '2026-05-01 10:00:00' },
    { pnl:    0, exited_at: '2026-05-02 10:00:00' },  // breakeven
    { pnl: -100, exited_at: '2026-05-03 10:00:00' },
  ]);
  assert.equal(r[0].trades, 3);
  assert.equal(r[0].wins, 1);
  assert.equal(r[0].losses, 1);
  assert.equal(r[0].win_rate, 0.3333);
});

test('aggregateMonthly: avg_win / avg_loss computed correctly', () => {
  const r = aggregateMonthly([
    { pnl:  100, exited_at: '2026-05-01 10:00:00' },
    { pnl:  300, exited_at: '2026-05-02 10:00:00' },
    { pnl: -200, exited_at: '2026-05-03 10:00:00' },
    { pnl: -400, exited_at: '2026-05-04 10:00:00' },
  ]);
  assert.equal(r[0].avg_win_inr,  200);    // (100+300)/2
  assert.equal(r[0].avg_loss_inr, -300);   // (-200-400)/2 — negative
});

// ---------- aggregateMonthly: max drawdown ----------

test('aggregateMonthly: max_drawdown computed over chronological trade equity curve', () => {
  // Trades arrive in chronological order: +500, -200, -400, +100
  // Cum equity:                              500,  300, -100,    0
  // Peak:                                    500,  500,  500,  500
  // DD vs peak:                                0, -200, -600, -500
  // Max DD = -600
  const r = aggregateMonthly([
    { pnl:  500, exited_at: '2026-05-01 10:00:00' },
    { pnl: -200, exited_at: '2026-05-02 10:00:00' },
    { pnl: -400, exited_at: '2026-05-03 10:00:00' },
    { pnl:  100, exited_at: '2026-05-04 10:00:00' },
  ]);
  assert.equal(r[0].max_drawdown_inr, -600);
});

test('aggregateMonthly: max_drawdown is 0 when month was monotonically up', () => {
  const r = aggregateMonthly([
    { pnl: 100, exited_at: '2026-05-01 10:00:00' },
    { pnl: 200, exited_at: '2026-05-02 10:00:00' },
    { pnl: 300, exited_at: '2026-05-03 10:00:00' },
  ]);
  assert.equal(r[0].max_drawdown_inr, 0);
});

test('aggregateMonthly: chronological sort applied even if input order is jumbled', () => {
  // Input out-of-order — output drawdown must still reflect chronological curve.
  const r = aggregateMonthly([
    { pnl: -400, exited_at: '2026-05-03 10:00:00' },
    { pnl:  500, exited_at: '2026-05-01 10:00:00' },
    { pnl:  100, exited_at: '2026-05-04 10:00:00' },
    { pnl: -200, exited_at: '2026-05-02 10:00:00' },
  ]);
  assert.equal(r[0].max_drawdown_inr, -600);
  assert.equal(r[0].net_pnl, 0);
});

// ---------- aggregateMonthly: multi-month ----------

test('aggregateMonthly returns one row per month, oldest-first', () => {
  const r = aggregateMonthly([
    { pnl: 100, exited_at: '2026-03-01 10:00:00' },
    { pnl: 200, exited_at: '2026-05-15 10:00:00' },
    { pnl: 300, exited_at: '2026-04-20 10:00:00' },
    { pnl: -50, exited_at: '2026-05-20 10:00:00' },
  ]);
  assert.equal(r.length, 3);
  assert.deepEqual(r.map(x => x.month), ['2026-03', '2026-04', '2026-05']);
  // May totals: 200 - 50 = 150 (2 trades)
  assert.equal(r[2].net_pnl, 150);
  assert.equal(r[2].trades, 2);
});

test('aggregateMonthly: drawdown is per-month, not lifetime', () => {
  // March: cum hits +1000 then drops to +200 → DD = -800
  // April: cum 0 → -500 → DD = -500
  const r = aggregateMonthly([
    { pnl:  1000, exited_at: '2026-03-01 10:00:00' },
    { pnl:  -800, exited_at: '2026-03-15 10:00:00' },
    { pnl:  -500, exited_at: '2026-04-01 10:00:00' },
  ]);
  assert.equal(r.length, 2);
  assert.equal(r[0].max_drawdown_inr, -800);   // March
  assert.equal(r[1].max_drawdown_inr, -500);   // April
});

// ---------- summarize ----------

test('summarize: empty input returns zeros', () => {
  const s = summarize([]);
  assert.deepEqual(s, {
    net_pnl: 0, trades: 0, wins: 0, win_rate: 0,
    best_month_pnl: 0, worst_month_pnl: 0, max_drawdown_inr: 0,
  });
});

test('summarize: net_pnl + trades + wins + win_rate aggregated across all months', () => {
  const s = summarize([
    { pnl:  500, exited_at: '2026-03-01 10:00:00' },
    { pnl: -200, exited_at: '2026-03-02 10:00:00' },
    { pnl:  300, exited_at: '2026-04-01 10:00:00' },
    { pnl:  100, exited_at: '2026-05-01 10:00:00' },
  ]);
  assert.equal(s.net_pnl, 700);
  assert.equal(s.trades, 4);
  assert.equal(s.wins, 3);
  assert.equal(s.win_rate, 0.75);
});

test('summarize: best_month / worst_month over all months', () => {
  const s = summarize([
    { pnl:  100, exited_at: '2026-03-01 10:00:00' },
    { pnl:  500, exited_at: '2026-04-01 10:00:00' },
    { pnl: -200, exited_at: '2026-05-01 10:00:00' },
  ]);
  assert.equal(s.best_month_pnl, 500);
  assert.equal(s.worst_month_pnl, -200);
});

test('summarize: max_drawdown_inr is the worst within-month DD across all months', () => {
  // March DD = -100 (cum 500 → 400)
  // April DD = -800 (cum 1000 → 200)
  // → overall worst-month DD = -800
  const s = summarize([
    { pnl:  500, exited_at: '2026-03-01 10:00:00' },
    { pnl: -100, exited_at: '2026-03-15 10:00:00' },
    { pnl: 1000, exited_at: '2026-04-01 10:00:00' },
    { pnl: -800, exited_at: '2026-04-15 10:00:00' },
  ]);
  assert.equal(s.max_drawdown_inr, -800);
});

// ---------- rounding ----------

test('aggregateMonthly rounds money values to 2 decimal places', () => {
  const r = aggregateMonthly([
    { pnl: 100.1234, exited_at: '2026-05-01 10:00:00' },
    { pnl:  50.5678, exited_at: '2026-05-02 10:00:00' },
  ]);
  assert.equal(r[0].net_pnl, 150.69);  // 150.6912 → 150.69
});

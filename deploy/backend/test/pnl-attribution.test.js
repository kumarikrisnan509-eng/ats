// Unit tests for pnl-attribution.js

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PnlAttribution } = require('../pnl-attribution');

const tmp = () => path.join('/tmp', 'pnl-test-' + Math.random().toString(36).slice(2) + '.json');

test('constructor rejects missing getStats/getTrades', () => {
  assert.throws(() => new PnlAttribution({}), /getStats/);
  assert.throws(() => new PnlAttribution({ getStats: () => ({}) }), /getTrades/);
});

test('snapshot writes a daily row', () => {
  const p = new PnlAttribution({
    getStats: () => ({ cash: 100000, totalEquity: 105000, realizedPnl: 5000, unrealizedPnl: 0, openPositions: 0, closedTrades: 3, filledOrders: 6 }),
    getTrades: () => [],
    storePath: tmp(),
  });
  const row = p.snapshot();
  assert.equal(row.date, new Date().toISOString().slice(0, 10));
  assert.equal(row.cash, 100000);
  assert.equal(row.totalEquity, 105000);
  assert.equal(row.realizedPnl, 5000);
  assert.equal(p.stats().rows, 1);
});

test('snapshot overwrites same-day row', () => {
  let equity = 105000;
  const p = new PnlAttribution({
    getStats: () => ({ totalEquity: equity, cash: 0, realizedPnl: 0, unrealizedPnl: 0, openPositions: 0, closedTrades: 0, filledOrders: 0 }),
    getTrades: () => [],
    storePath: tmp(),
  });
  p.snapshot();
  equity = 110000;
  p.snapshot();
  assert.equal(p.stats().rows, 1);                            // same day, overwritten not appended
  assert.equal(p.stats().latest.totalEquity, 110000);
});

test('byStrategy groups closed trades correctly', () => {
  const trades = [
    { realizedPnl: 250, strategy: 'rsi' },
    { realizedPnl: -100, strategy: 'rsi' },
    { realizedPnl: 500, strategy: 'ema' },
    { realizedPnl: 75 },   // no strategy -> manual
  ];
  const p = new PnlAttribution({
    getStats: () => ({}),
    getTrades: () => trades,
    storePath: tmp(),
  });
  const out = p.byStrategy();
  // Sorted by realizedPnl desc
  assert.equal(out[0].strategy, 'ema');
  assert.equal(out[0].realizedPnl, 500);
  assert.equal(out[0].winRate, 100);
  assert.equal(out[1].strategy, 'rsi');
  assert.equal(out[1].realizedPnl, 150);
  assert.equal(out[1].winRate, 50);
  assert.equal(out[1].bestTrade, 250);
  assert.equal(out[1].worstTrade, -100);
  assert.equal(out[2].strategy, 'manual');
});

test('history() returns last N rows + day-over-day delta', () => {
  const p = new PnlAttribution({
    getStats: () => ({ totalEquity: 100000, cash: 0, realizedPnl: 0, unrealizedPnl: 0, openPositions: 0, closedTrades: 0, filledOrders: 0 }),
    getTrades: () => [],
    storePath: tmp(),
  });
  // Manually inject 5 days of rows
  p._rows = [
    { date: '2026-05-10', totalEquity: 100000, cash: 0, realizedPnl: 0, unrealizedPnl: 0, openPositions: 0, closedTrades: 0, filledOrders: 0, ts: '' },
    { date: '2026-05-11', totalEquity: 101000, cash: 0, realizedPnl: 0, unrealizedPnl: 0, openPositions: 0, closedTrades: 0, filledOrders: 0, ts: '' },
    { date: '2026-05-12', totalEquity: 99500,  cash: 0, realizedPnl: 0, unrealizedPnl: 0, openPositions: 0, closedTrades: 0, filledOrders: 0, ts: '' },
    { date: '2026-05-13', totalEquity: 102000, cash: 0, realizedPnl: 0, unrealizedPnl: 0, openPositions: 0, closedTrades: 0, filledOrders: 0, ts: '' },
  ];
  const h = p.history(10);
  assert.equal(h.length, 4);
  assert.equal(h[0].dayDelta, 0);
  assert.equal(h[1].dayDelta, 1000);    // 101000 - 100000
  assert.equal(h[2].dayDelta, -1500);   // 99500 - 101000
  assert.equal(h[3].dayDelta, 2500);    // 102000 - 99500
});

test('persistence round-trip', () => {
  const store = tmp();
  const p1 = new PnlAttribution({
    getStats: () => ({ totalEquity: 123456, cash: 0, realizedPnl: 100, unrealizedPnl: 0, openPositions: 0, closedTrades: 1, filledOrders: 2 }),
    getTrades: () => [],
    storePath: store,
  });
  p1.snapshot();
  const p2 = new PnlAttribution({
    getStats: () => ({}),
    getTrades: () => [],
    storePath: store,
  });
  p2.load();
  assert.equal(p2.stats().rows, 1);
  assert.equal(p2.stats().latest.totalEquity, 123456);
  fs.unlinkSync(store);
});

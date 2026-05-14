// Unit tests for paper.js -- PaperTrading simulator.
// Run with: npm test (uses node --test, no external deps).

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { PaperTrading } = require('../paper');

const tmp = () => path.join('/tmp', 'paper-test-' + Math.random().toString(36).slice(2) + '.json');

test('placeOrder rejects bad inputs', () => {
  const p = new PaperTrading({ storePath: tmp() });
  assert.throws(() => p.placeOrder({}), /symbol/);
  assert.throws(() => p.placeOrder({ symbol: 'X' }), /side/);
  assert.throws(() => p.placeOrder({ symbol: 'X', side: 'BUY' }), /qty/);
  assert.throws(() => p.placeOrder({ symbol: 'X', side: 'BUY', qty: 0 }), /qty/);
  assert.throws(() => p.placeOrder({ symbol: 'X', side: 'BUY', qty: 1, type: 'LIMIT' }), /price/);
});

test('placeOrder MARKET stays PENDING until tick fills it', () => {
  const p = new PaperTrading({ storePath: tmp() });
  const o = p.placeOrder({ symbol: 'RELIANCE', side: 'BUY', qty: 10, type: 'MARKET' });
  assert.equal(o.status, 'PENDING');
  assert.equal(o.symbol, 'RELIANCE');
  assert.equal(o.qty, 10);
  assert.equal(o.strategy, null);
  assert.match(o.id, /^[0-9a-f-]{36}$/);
});

test('strategy tag flows through to closed-trade ledger', () => {
  const p = new PaperTrading({ storePath: tmp() });
  p.placeOrder({ symbol: 'INFY', side: 'BUY', qty: 5, type: 'MARKET', strategy: 'rsi_mean_revert' });
  p.onTick({ symbol: 'INFY', ltp: 1500 });
  p.placeOrder({ symbol: 'INFY', side: 'SELL', qty: 5, type: 'MARKET', strategy: 'rsi_mean_revert' });
  p.onTick({ symbol: 'INFY', ltp: 1550 });
  const trades = p.trades();
  assert.equal(trades.length, 1);
  assert.equal(trades[0].strategy, 'rsi_mean_revert');
  assert.equal(trades[0].realizedPnl, 250);   // (1550-1500)*5
  assert.equal(trades[0].side, 'LONG');
});

test('MARKET BUY then SELL: realized P&L = (sell - buy) * qty', () => {
  const p = new PaperTrading({ storePath: tmp(), startingCash: 100000 });
  p.placeOrder({ symbol: 'TCS', side: 'BUY', qty: 10, type: 'MARKET' });
  p.onTick({ symbol: 'TCS', ltp: 4000 });   // buy fills at 4000
  let stats = p.stats();
  assert.equal(stats.cash, 60000);            // 100000 - 10*4000
  assert.equal(stats.openPositions, 1);
  p.placeOrder({ symbol: 'TCS', side: 'SELL', qty: 10, type: 'MARKET' });
  p.onTick({ symbol: 'TCS', ltp: 4100 });   // sell fills at 4100
  stats = p.stats();
  assert.equal(stats.cash, 101000);           // 60000 + 10*4100
  assert.equal(stats.openPositions, 0);
  assert.equal(stats.realizedPnl, 1000);
  assert.equal(stats.closedTrades, 1);
});

test('LIMIT BUY fills when tick crosses below limit', () => {
  const p = new PaperTrading({ storePath: tmp() });
  const o = p.placeOrder({ symbol: 'X', side: 'BUY', qty: 1, type: 'LIMIT', price: 100 });
  p.onTick({ symbol: 'X', ltp: 110 });   // above limit -- no fill
  assert.equal(p.list().find(x => x.id === o.id).status, 'PENDING');
  p.onTick({ symbol: 'X', ltp: 99 });    // below limit -- fills at limit price
  const filled = p.list().find(x => x.id === o.id);
  assert.equal(filled.status, 'FILLED');
  assert.equal(filled.filledPrice, 100);
});

test('cancelOrder cancels PENDING, rejects already-FILLED', () => {
  const p = new PaperTrading({ storePath: tmp() });
  const o = p.placeOrder({ symbol: 'A', side: 'BUY', qty: 1, type: 'LIMIT', price: 50 });
  const r1 = p.cancelOrder(o.id);
  assert.equal(r1.cancelled, true);
  assert.equal(p.list()[0].status, 'CANCELLED');
  const r2 = p.cancelOrder(o.id);
  assert.equal(r2.cancelled, false);
  assert.match(r2.reason, /already/);
});

test('persistence round-trip', () => {
  const store = tmp();
  const p1 = new PaperTrading({ storePath: store, startingCash: 50000 });
  p1.placeOrder({ symbol: 'B', side: 'BUY', qty: 2, type: 'MARKET' });
  p1.onTick({ symbol: 'B', ltp: 200 });   // fills, persists via debounce
  p1._persist();                          // force sync flush
  const p2 = new PaperTrading({ storePath: store });
  p2.load();
  assert.equal(p2.stats().filledOrders, 1);
  assert.equal(p2.stats().openPositions, 1);
  assert.equal(p2.stats().cash, 49600);   // 50000 - 2*200
  fs.unlinkSync(store);
});

test('reset clears everything and restores starting cash', () => {
  const p = new PaperTrading({ storePath: tmp(), startingCash: 1000000 });
  p.placeOrder({ symbol: 'C', side: 'BUY', qty: 1, type: 'MARKET' });
  p.onTick({ symbol: 'C', ltp: 100 });
  p.reset();
  assert.equal(p.stats().cash, 1000000);
  assert.equal(p.stats().filledOrders, 0);
  assert.equal(p.stats().openPositions, 0);
});

test('positions() returns unrealized P&L using lastTicks accessor', () => {
  const ticks = new Map([['D', 250]]);
  const p = new PaperTrading({ storePath: tmp(), lastTicks: () => ticks });
  p.placeOrder({ symbol: 'D', side: 'BUY', qty: 4, type: 'MARKET' });
  p.onTick({ symbol: 'D', ltp: 200 });   // buys at 200
  const positions = p.positions();
  assert.equal(positions.length, 1);
  assert.equal(positions[0].symbol, 'D');
  assert.equal(positions[0].qty, 4);
  assert.equal(positions[0].avgPrice, 200);
  assert.equal(positions[0].ltp, 250);
  assert.equal(positions[0].unrealizedPnl, 200);   // (250-200)*4
});

test('audit callback receives expected events', () => {
  const events = [];
  const p = new PaperTrading({ storePath: tmp(), audit: (k, d) => events.push({ k, d }) });
  p.placeOrder({ symbol: 'E', side: 'BUY', qty: 1, type: 'MARKET' });
  p.onTick({ symbol: 'E', ltp: 100 });
  assert.deepEqual(events.map(e => e.k), ['paper.order.placed', 'paper.order.filled']);
});

// Unit tests for autorun.js -- strategy auto-runner.

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { AutoRunner } = require('../autorun');
const { computeSignal } = require('../backtest');

const tmp = () => path.join('/tmp', 'autorun-test-' + Math.random().toString(36).slice(2) + '.json');

// Synthetic mean-reverting candles that guarantee an RSI<30 signal at the last bar
function genOversoldCandles() {
  const candles = [];
  // 50 flat bars then 10 down-bars to push RSI low
  for (let i = 0; i < 50; i++) {
    const p = 100;
    candles.push({ date: `2025-01-${String(i+1).padStart(2,'0')}`, open: p, high: p+0.1, low: p-0.1, close: p });
  }
  for (let i = 0; i < 10; i++) {
    const p = 100 - i * 2;
    candles.push({ date: `2025-02-${String(i+1).padStart(2,'0')}`, open: p, high: p+0.1, low: p-0.1, close: p });
  }
  return candles;
}

const mockBroker = (candles) => ({ getHistorical: async () => candles });
const mockPaper = () => {
  const placed = [];
  return {
    _placed: placed,
    placeOrder: (o) => { placed.push(o); return { id: 'fake-' + placed.length, ...o }; },
  };
};

test('constructor rejects missing required deps', () => {
  assert.throws(() => new AutoRunner({}), /broker/);
  assert.throws(() => new AutoRunner({ broker: {} }), /paper/);
  assert.throws(() => new AutoRunner({ broker: {}, paper: {} }), /computeSignal/);
});

test('runOnce skips when no config set', async () => {
  const r = new AutoRunner({ broker: mockBroker([]), paper: mockPaper(), computeSignal, storePath: tmp() });
  const result = await r.runOnce();
  assert.equal(result.result, 'skipped');
  assert.equal(result.reason, 'no_config');
});

test('runOnce skips when config disabled', async () => {
  const r = new AutoRunner({ broker: mockBroker([]), paper: mockPaper(), computeSignal, storePath: tmp() });
  r.setConfig({ enabled: false, strategy: 'rsi_mean_revert', symbol: 'X', qty: 1 });
  const result = await r.runOnce();
  assert.equal(result.result, 'skipped');
  assert.equal(result.reason, 'disabled');
});

test('setConfig validates required fields', () => {
  const r = new AutoRunner({ broker: mockBroker([]), paper: mockPaper(), computeSignal, storePath: tmp() });
  assert.throws(() => r.setConfig({}), /strategy/);
  assert.throws(() => r.setConfig({ strategy: 'rsi_mean_revert' }), /symbol/);
  assert.throws(() => r.setConfig({ strategy: 'bogus', symbol: 'X' }), /strategy must be one of/);
});

test('runOnce places paper order when signal fires at last bar', async () => {
  const candles = genOversoldCandles();
  const paper = mockPaper();
  const r = new AutoRunner({ broker: mockBroker(candles), paper, computeSignal, storePath: tmp() });
  r.setConfig({
    enabled: true,
    strategy: 'rsi_mean_revert',
    symbol: 'TEST',
    params: { period: 14, entryRsi: 50, exitRsi: 50 },   // wide thresholds for synthetic data
    qty: 7,
  });
  const result = await r.runOnce({ source: 'manual' });
  assert.equal(result.result, 'placed');
  assert.equal(result.signal, 'BUY');
  assert.equal(paper._placed.length, 1);
  assert.equal(paper._placed[0].symbol, 'TEST');
  assert.equal(paper._placed[0].qty, 7);
  assert.equal(paper._placed[0].strategy, 'rsi_mean_revert');
});

test('runOnce dedupes same-bar same-direction signals', async () => {
  const candles = genOversoldCandles();
  const paper = mockPaper();
  const r = new AutoRunner({ broker: mockBroker(candles), paper, computeSignal, storePath: tmp() });
  r.setConfig({ enabled: true, strategy: 'rsi_mean_revert', symbol: 'X', params: { period: 14, entryRsi: 50, exitRsi: 50 }, qty: 1 });
  const r1 = await r.runOnce();
  const r2 = await r.runOnce();
  assert.equal(r1.result, 'placed');
  assert.equal(r2.result, 'deduped');
  assert.equal(paper._placed.length, 1);
});

test('runOnce returns no_signal when no signal at last bar', async () => {
  // Balanced up/down -- RSI lands near 50, neither below entry (30) nor above exit (70)
  const candles = [];
  for (let i = 0; i < 60; i++) {
    const p = 100 + (i % 2 === 0 ? 1 : -1);
    candles.push({ date: `2025-01-${String(i+1).padStart(2,'0')}`, open: p, high: p+0.1, low: p-0.1, close: p });
  }
  const r = new AutoRunner({ broker: mockBroker(candles), paper: mockPaper(), computeSignal, storePath: tmp() });
  r.setConfig({ enabled: true, strategy: 'rsi_mean_revert', symbol: 'X', params: { period: 14, entryRsi: 30, exitRsi: 70 }, qty: 1 });
  const result = await r.runOnce();
  assert.equal(result.result, 'no_signal');
});

test('runOnce returns skipped when insufficient candles', async () => {
  const r = new AutoRunner({ broker: mockBroker([{ date: 'd', open:1, high:1, low:1, close:1 }]), paper: mockPaper(), computeSignal, storePath: tmp() });
  r.setConfig({ enabled: true, strategy: 'rsi_mean_revert', symbol: 'X', qty: 1 });
  const result = await r.runOnce();
  assert.equal(result.result, 'skipped');
  assert.match(result.reason, /insufficient/);
});

test('history() returns newest-first', async () => {
  const r = new AutoRunner({ broker: mockBroker([]), paper: mockPaper(), computeSignal, storePath: tmp() });
  r.setConfig({ enabled: true, strategy: 'rsi_mean_revert', symbol: 'X', qty: 1 });
  await r.runOnce();
  await r.runOnce();
  await r.runOnce();
  const h = r.history(10);
  assert.equal(h.length, 3);
  // Should be newest-first
  assert.ok(h[0].ts >= h[1].ts);
  assert.ok(h[1].ts >= h[2].ts);
});

test('clearConfig stops timer + clears state', () => {
  const r = new AutoRunner({ broker: mockBroker([]), paper: mockPaper(), computeSignal, storePath: tmp() });
  r.setConfig({ enabled: true, strategy: 'rsi_mean_revert', symbol: 'X', qty: 1 });
  assert.equal(r.stats().enabled, true);
  r.clearConfig();
  assert.equal(r.stats().configSet, false);
  assert.equal(r.stats().enabled, false);
});

test('persistence round-trip', async () => {
  const store = tmp();
  const r1 = new AutoRunner({ broker: mockBroker([]), paper: mockPaper(), computeSignal, storePath: store });
  r1.setConfig({ enabled: true, strategy: 'ema_cross', symbol: 'X', qty: 3, intervalMinutes: 10 });
  await r1.runOnce({ source: 'manual' });
  const r2 = new AutoRunner({ broker: mockBroker([]), paper: mockPaper(), computeSignal, storePath: store });
  r2.load();
  assert.equal(r2.config().symbol, 'X');
  assert.equal(r2.config().intervalMinutes, 10);
  assert.equal(r2.history(10).length, 1);
  fs.unlinkSync(store);
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Replay } = require('../replay');

// Mock computeSignal: BUY every 10th bar, SELL every 15th
const mockSignal = ({ candles }) => {
  return candles.map((_, i) => {
    if (i > 0 && i % 10 === 0 && i % 15 !== 0) return 'BUY';
    if (i > 0 && i % 15 === 0) return 'SELL';
    return null;
  });
};

function mkCandles(n, start = 100) {
  const out = [];
  let p = start;
  for (let i = 0; i < n; i++) {
    p += (i % 7 === 0 ? -2 : 1);
    out.push({
      date: '2025-01-' + String(i + 1).padStart(2, '0'),
      open: p, high: p + 1, low: p - 1, close: p, volume: 1000,
    });
  }
  return out;
}

test('rejects fewer than 30 candles', () => {
  const r = new Replay({ computeSignal: mockSignal });
  assert.throws(() => r.replay({ candles: mkCandles(20), strategy: 'mock' }), />= 30 candles/);
});

test('returns one bar per input candle', () => {
  const r = new Replay({ computeSignal: mockSignal });
  const out = r.replay({ candles: mkCandles(60), strategy: 'mock' });
  assert.equal(out.bars.length, 60);
});

test('each bar has ohlc, equity, optional event', () => {
  const r = new Replay({ computeSignal: mockSignal });
  const out = r.replay({ candles: mkCandles(60), strategy: 'mock' });
  for (const b of out.bars) {
    assert.ok(b.ohlc);
    assert.ok(b.ohlc.c >= 0);
    assert.equal(typeof b.equity, 'number');
  }
});

test('stats counts trades + win/loss correctly', () => {
  const r = new Replay({ computeSignal: mockSignal });
  const out = r.replay({ candles: mkCandles(60), strategy: 'mock' });
  assert.ok(out.stats.trades > 0);
  assert.equal(out.stats.wins + out.stats.losses <= out.stats.trades, true);
  assert.equal(typeof out.stats.totalPnl, 'number');
  assert.equal(typeof out.stats.maxDrawdownINR, 'number');
});

test('open position force-closed at last bar', () => {
  const buyOnly = ({ candles }) => candles.map((_, i) => i === 5 ? 'BUY' : null);
  const r = new Replay({ computeSignal: buyOnly });
  const out = r.replay({ candles: mkCandles(40), strategy: 'mock' });
  const last = out.bars[out.bars.length - 1];
  assert.ok(last.event);
  assert.equal(last.event.kind, 'FORCE_EXIT');
});

// T-214 (CODE-AUDIT F.5 M1.4 — server.js split, piece 1): strategies registry.
//
// Lifted from server.js where this 225-line const + trivial route lived
// inline. Pure data + a one-statement handler; no closures over the rest
// of server.js (no kill switch, no broker, no audit). Safe extract.
//
// Two exports:
//   STRATEGIES                 — the array (still needed by server.js for
//                                the ai-workflows router constructor).
//   mountStrategiesRoutes(app) — registers GET /api/strategies.

'use strict';

const STRATEGIES = [
  {
    id: 'rsi_mean_revert',
    name: 'RSI mean reversion',
    description: 'Long-only: BUY when RSI(period) < entryRsi; SELL when RSI > exitRsi.',
    bias: 'mean-reverting markets, range-bound',
    params: [
      { name: 'period',   type: 'int',   default: 14, min: 2,  max: 100 },
      { name: 'entryRsi', type: 'float', default: 30, min: 1,  max: 99 },
      { name: 'exitRsi',  type: 'float', default: 70, min: 1,  max: 99 },
    ],
  },
  {
    id: 'ema_cross',
    name: 'EMA cross',
    description: 'Long-only: BUY when close crosses above N-EMA; SELL when crosses below.',
    bias: 'trending markets',
    params: [
      { name: 'period', type: 'int', default: 20, min: 2, max: 200 },
    ],
  },
  {
    id: 'macd_cross',
    name: 'MACD signal cross',
    description: 'Long-only: BUY when MACD(fast,slow) line crosses above signal line; SELL on opposite cross.',
    bias: 'trending markets, momentum',
    params: [
      { name: 'fast',   type: 'int', default: 12, min: 2,  max: 50 },
      { name: 'slow',   type: 'int', default: 26, min: 3,  max: 200 },
      { name: 'signal', type: 'int', default: 9,  min: 2,  max: 50 },
    ],
  },
  {
    id: 'bollinger',
    name: 'Bollinger band mean reversion',
    description: 'Long-only: BUY when close crosses below lower band (oversold); SELL when close crosses above middle band.',
    bias: 'mean-reverting markets, range-bound',
    params: [
      { name: 'period', type: 'int',   default: 20, min: 5,    max: 200 },
      { name: 'k',      type: 'float', default: 2,  min: 0.5,  max: 5 },
    ],
  },
  // ---------- Tier 16: 3 new TA strategies (toward the 22-layer goal) ----------
  {
    id: 'supertrend',
    name: 'Supertrend',
    description: 'Long-only: BUY on Supertrend flip up; SELL on flip down. Uses ATR-based upper/lower bands.',
    bias: 'trending markets',
    params: [
      { name: 'period',     type: 'int',   default: 10, min: 5,   max: 50 },
      { name: 'multiplier', type: 'float', default: 3,  min: 1,   max: 8 },
    ],
  },
  {
    id: 'adx_trend',
    name: 'ADX trend filter',
    description: 'Long-only: BUY when ADX > threshold and +DI > -DI (strong uptrend); SELL on opposite. Skips trade when ADX < threshold.',
    bias: 'strongly trending markets',
    params: [
      { name: 'period',    type: 'int',   default: 14, min: 5,   max: 50 },
      { name: 'threshold', type: 'float', default: 25, min: 10,  max: 50 },
    ],
  },
  {
    id: 'donchian',
    name: 'Donchian breakout',
    description: 'Long-only: BUY when close breaks above N-period rolling high; SELL when close breaks below rolling low. Classic Turtle-trader rule.',
    bias: 'trending markets, breakout',
    params: [
      { name: 'period', type: 'int', default: 20, min: 5, max: 100 },
    ],
  },
  // ---------- Tier 17: 3 more TA strategies (10 total, building toward 22-layer goal) ----------
  {
    id: 'stochastic',
    name: 'Stochastic %K cross',
    description: 'Long-only: BUY when %K crosses above %D in oversold region; SELL when %K crosses below %D in overbought region.',
    bias: 'mean-reverting markets, oscillating',
    params: [
      { name: 'period',     type: 'int',   default: 14, min: 5,  max: 50 },
      { name: 'smoothK',    type: 'int',   default: 3,  min: 1,  max: 10 },
      { name: 'smoothD',    type: 'int',   default: 3,  min: 1,  max: 10 },
      { name: 'oversold',   type: 'float', default: 20, min: 0,  max: 50 },
      { name: 'overbought', type: 'float', default: 80, min: 50, max: 100 },
    ],
  },
  {
    id: 'williams_r',
    name: "Williams %R",
    description: 'Long-only: BUY when %R crosses up through oversold (-80 default); SELL when %R crosses down through overbought (-20).',
    bias: 'mean-reverting markets, oscillating',
    params: [
      { name: 'period',     type: 'int',   default: 14, min: 5,    max: 50 },
      { name: 'oversold',   type: 'float', default: -80, min: -100, max: -50 },
      { name: 'overbought', type: 'float', default: -20, min: -50,  max: 0   },
    ],
  },
  {
    id: 'heikin_ashi',
    name: 'Heikin-Ashi trend',
    description: 'Long-only: BUY after N consecutive bullish Heikin-Ashi candles; SELL after N consecutive bearish ones.',
    bias: 'trending markets, momentum',
    params: [
      { name: 'run', type: 'int', default: 3, min: 2, max: 10 },
    ],
  },
  // ---------- Tier 18: 4 more TA strategies (14 total) ----------
  {
    id: 'cci',
    name: 'Commodity Channel Index',
    description: 'Long-only: BUY when CCI crosses up through -threshold (oversold exit); SELL when CCI crosses down through +threshold.',
    bias: 'mean-reverting markets',
    params: [
      { name: 'period',    type: 'int',   default: 20,  min: 5,  max: 100 },
      { name: 'threshold', type: 'float', default: 100, min: 50, max: 200 },
    ],
  },
  {
    id: 'keltner',
    name: 'Keltner Channels',
    description: 'Long-only: BUY on close break above EMA + k*ATR; SELL on close break below EMA - k*ATR. Breakout strategy.',
    bias: 'trending markets, breakout',
    params: [
      { name: 'period',     type: 'int',   default: 20, min: 5,   max: 100 },
      { name: 'multiplier', type: 'float', default: 2,  min: 0.5, max: 5 },
    ],
  },
  {
    id: 'obv',
    name: 'OBV divergence',
    description: 'Long-only: BUY on bullish OBV/price divergence (price lower-low + OBV higher-low); SELL on bearish divergence.',
    bias: 'turn-detection, mean-reverting',
    params: [
      { name: 'lookback', type: 'int', default: 20, min: 5, max: 100 },
    ],
  },
  {
    id: 'psar',
    name: 'Parabolic SAR',
    description: 'Long-only: BUY on SAR flip from downtrend to uptrend; SELL on flip back. Trend-following stop-and-reverse.',
    bias: 'trending markets, stop-and-reverse',
    params: [
      { name: 'acceleration',    type: 'float', default: 0.02, min: 0.005, max: 0.1 },
      { name: 'maxAcceleration', type: 'float', default: 0.2,  min: 0.05,  max: 0.5 },
    ],
  },
  // ---------- Tier 19: 4 more TA strategies (18 total) ----------
  {
    id: 'aroon',
    name: 'Aroon oscillator',
    description: 'Long-only: BUY when Aroon Up crosses above Aroon Down; SELL when crosses below. Trend-strength oscillator.',
    bias: 'trending markets, regime-change',
    params: [
      { name: 'period', type: 'int', default: 14, min: 5, max: 50 },
    ],
  },
  {
    id: 'cmf',
    name: 'Chaikin Money Flow',
    description: 'Long-only: BUY when CMF crosses up through +threshold (accumulation); SELL when CMF crosses down through -threshold (distribution).',
    bias: 'volume-confirmation, trending',
    params: [
      { name: 'period',    type: 'int',   default: 20,   min: 5,    max: 100 },
      { name: 'threshold', type: 'float', default: 0.05, min: 0.01, max: 0.3 },
    ],
  },
  {
    id: 'atr_trail',
    name: 'ATR trailing stop',
    description: 'Long-only: enter when close above EMA; exit when close drops below highest-high minus k*ATR trailing stop.',
    bias: 'trending markets, exit-discipline',
    params: [
      { name: 'period',     type: 'int',   default: 14, min: 5,   max: 50 },
      { name: 'multiplier', type: 'float', default: 3,  min: 1,   max: 8 },
    ],
  },
  {
    id: 'ichimoku',
    name: 'Ichimoku Tenkan/Kijun cross',
    description: 'Long-only: BUY when Tenkan (9-period mid) crosses above Kijun (26-period mid); SELL on opposite cross. Simplified Ichimoku.',
    bias: 'trending markets, momentum',
    params: [
      { name: 'tenkan', type: 'int', default: 9,  min: 3, max: 30 },
      { name: 'kijun',  type: 'int', default: 26, min: 9, max: 60 },
    ],
  },
  // ---------- Tier 20: 4 final TA strategies (22 total -- spec target reached) ----------
  {
    id: 'vwap',
    name: 'VWAP cross (rolling)',
    description: 'Long-only: BUY when close crosses above N-period rolling VWAP; SELL on opposite. Volume-weighted trend filter.',
    bias: 'trending markets, volume-aware',
    params: [
      { name: 'period', type: 'int', default: 20, min: 5, max: 100 },
    ],
  },
  {
    id: 'pivot',
    name: 'Pivot Points (R1/S1)',
    description: 'Long-only: BUY when close breaks above prior-day R1 pivot; SELL when close breaks below S1. Classic floor-trader rule.',
    bias: 'breakout markets',
    params: [],
  },
  {
    id: 'mfi',
    name: 'Money Flow Index',
    description: 'Long-only: BUY when MFI crosses up through oversold; SELL when MFI crosses down through overbought. Volume-weighted RSI.',
    bias: 'mean-reverting markets, volume-aware',
    params: [
      { name: 'period',     type: 'int',   default: 14, min: 5,  max: 50 },
      { name: 'oversold',   type: 'float', default: 20, min: 5,  max: 40 },
      { name: 'overbought', type: 'float', default: 80, min: 60, max: 95 },
    ],
  },
  {
    id: 'trix',
    name: 'TRIX',
    description: 'Long-only: BUY when TRIX (triple-smoothed EMA momentum) crosses above its signal line; SELL on opposite. Noise-resistant momentum.',
    bias: 'trending markets, momentum',
    params: [
      { name: 'period', type: 'int', default: 15, min: 5, max: 50 },
      { name: 'signal', type: 'int', default: 9,  min: 3, max: 30 },
    ],
  },
];

function mountStrategiesRoutes(app) {
  app.get('/api/strategies', (_req, res) => {
    res.json({ ok: true, strategies: STRATEGIES });
  });
}

module.exports = { STRATEGIES, mountStrategiesRoutes };

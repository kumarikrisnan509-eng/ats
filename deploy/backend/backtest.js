// backtest.js — strategy simulation on historical candles.
//
// Two built-in strategies (reuses scanner indicator code):
//   1. rsi_mean_revert: BUY when RSI < entryRsi (default 30); SELL when RSI > exitRsi (default 70)
//   2. ema_cross:       BUY when close crosses above N-EMA; SELL when crosses below
//
// Both are long-only (no shorting). One position at a time. Each closed trade
// records entry/exit + P&L. Final report includes win-rate, max drawdown,
// and the equity curve (one point per bar).

const { rsi, ema, macd, bollinger, atr, adx } = require('./scanner');

const DEFAULT_QTY = 1;

/**
 * @param {object} args
 * @param {Array<{date:string,open:number,high:number,low:number,close:number,volume:number}>} args.candles
 * @param {string} args.strategy             "rsi_mean_revert" | "ema_cross"
 * @param {object} [args.params]             strategy-specific params
 * @param {number} [args.qty]                shares per trade
 * @returns {object} { trades:[], stats:{...}, equity:[] }
 */
function runBacktest({ candles, strategy, params, qty }) {
  if (!Array.isArray(candles) || candles.length < 30) {
    throw new Error('need at least 30 candles');
  }
  qty = qty || DEFAULT_QTY;
  params = params || {};

  const closes = candles.map(c => c.close);
  let signal;
  if (strategy === 'rsi_mean_revert') {
    signal = signalRsiMeanRevert(closes, params);
  } else if (strategy === 'ema_cross') {
    signal = signalEmaCross(closes, params);
  } else if (strategy === 'macd_cross') {
    signal = signalMacdCross(closes, params);
  } else if (strategy === 'bollinger') {
    signal = signalBollinger(closes, params);
  } else if (strategy === 'supertrend') {
    signal = signalSupertrend(candles, params);
  } else if (strategy === 'adx_trend') {
    signal = signalAdxTrend(candles, params);
  } else if (strategy === 'donchian') {
    signal = signalDonchian(candles, params);
  } else if (strategy === 'stochastic') {
    signal = signalStochastic(candles, params);
  } else if (strategy === 'williams_r') {
    signal = signalWilliamsR(candles, params);
  } else if (strategy === 'heikin_ashi') {
    signal = signalHeikinAshi(candles, params);
  } else {
    throw new Error(`unknown strategy: ${strategy}`);
  }

  // signal[i] in {'BUY','SELL', null} — action AT bar i (use close as fill price)
  const trades = [];
  const equity = []; // [{date, equity}]
  let cash = 0;
  let position = null; // { entryDate, entryPrice }

  for (let i = 0; i < candles.length; i++) {
    const bar = candles[i];
    const act = signal[i];

    if (act === 'BUY' && !position) {
      position = { entryDate: bar.date, entryPrice: bar.close };
    } else if (act === 'SELL' && position) {
      const pnl = +((bar.close - position.entryPrice) * qty).toFixed(2);
      cash += pnl;
      trades.push({
        entryDate: position.entryDate,
        entryPrice: position.entryPrice,
        exitDate:  bar.date,
        exitPrice: bar.close,
        qty,
        pnl,
        pnlPct: +(((bar.close - position.entryPrice) / position.entryPrice) * 100).toFixed(2),
      });
      position = null;
    }

    // Mark-to-market equity at this bar
    const unrealized = position ? (bar.close - position.entryPrice) * qty : 0;
    equity.push({ date: bar.date, equity: +(cash + unrealized).toFixed(2) });
  }

  // Force-close any open position at the last bar so stats are honest.
  if (position && candles.length > 0) {
    const last = candles[candles.length - 1];
    const pnl = +((last.close - position.entryPrice) * qty).toFixed(2);
    cash += pnl;
    trades.push({
      entryDate: position.entryDate,
      entryPrice: position.entryPrice,
      exitDate:  last.date,
      exitPrice: last.close,
      qty,
      pnl,
      pnlPct: +(((last.close - position.entryPrice) / position.entryPrice) * 100).toFixed(2),
      forcedClose: true,
    });
  }

  // Stats
  const wins   = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl < 0);
  const winRate = trades.length ? +(wins.length / trades.length * 100).toFixed(2) : 0;
  const totalPnl = +trades.reduce((s, t) => s + t.pnl, 0).toFixed(2);
  const avgWin  = wins.length   ? +(wins.reduce((s, t) => s + t.pnl, 0) / wins.length).toFixed(2)   : 0;
  const avgLoss = losses.length ? +(losses.reduce((s, t) => s + t.pnl, 0) / losses.length).toFixed(2) : 0;

  // Max drawdown over equity curve
  let peak = -Infinity, maxDd = 0, maxDdPct = 0;
  for (const e of equity) {
    if (e.equity > peak) peak = e.equity;
    const dd = peak - e.equity;
    if (dd > maxDd) {
      maxDd = +dd.toFixed(2);
      maxDdPct = peak !== 0 ? +(dd / Math.abs(peak === 0 ? 1 : peak) * 100).toFixed(2) : 0;
    }
  }

  // Buy & hold benchmark
  const bhPnl = candles.length > 1
    ? +(((candles[candles.length - 1].close - candles[0].close) * qty).toFixed(2))
    : 0;

  return {
    strategy,
    params,
    qty,
    bars: candles.length,
    trades,
    stats: {
      trades: trades.length,
      wins: wins.length,
      losses: losses.length,
      winRate,
      totalPnl,
      avgWin,
      avgLoss,
      maxDrawdown: maxDd,
      maxDrawdownPct: maxDdPct,
      buyAndHoldPnl: bhPnl,
      vsBuyAndHold: +(totalPnl - bhPnl).toFixed(2),
    },
    equity,
  };
}

// ---------- Signal generators ----------

function signalRsiMeanRevert(closes, params) {
  const period   = params.period   || 14;
  const entryRsi = params.entryRsi || 30;
  const exitRsi  = params.exitRsi  || 70;
  const out = new Array(closes.length).fill(null);
  for (let i = period + 1; i < closes.length; i++) {
    const sub = closes.slice(0, i + 1);
    const r = rsi(sub, period);
    if (!Number.isFinite(r)) continue;
    if (r < entryRsi) out[i] = 'BUY';
    else if (r > exitRsi) out[i] = 'SELL';
  }
  return out;
}

function signalEmaCross(closes, params) {
  const period = params.period || 20;
  const e = ema(closes, period);
  const out = new Array(closes.length).fill(null);
  for (let i = period + 1; i < closes.length; i++) {
    const cNow = closes[i],   cPrev = closes[i - 1];
    const eNow = e[i],        ePrev = e[i - 1];
    if (!Number.isFinite(eNow) || !Number.isFinite(ePrev)) continue;
    const crossedUp   = cNow > eNow && cPrev <= ePrev;
    const crossedDown = cNow < eNow && cPrev >= ePrev;
    if (crossedUp)   out[i] = 'BUY';
    if (crossedDown) out[i] = 'SELL';
  }
  return out;
}

/** MACD line crossing the signal line. Classic trend follower. */
function signalMacdCross(closes, params) {
  const fast   = params.fast   || 12;
  const slow   = params.slow   || 26;
  const signal = params.signal || 9;
  const { line, sig } = macd(closes, fast, slow, signal);
  const out = new Array(closes.length).fill(null);
  for (let i = slow + signal + 1; i < closes.length; i++) {
    const lNow = line[i], lPrev = line[i - 1];
    const sNow = sig[i],  sPrev = sig[i - 1];
    if (!Number.isFinite(lNow) || !Number.isFinite(sNow) || !Number.isFinite(lPrev) || !Number.isFinite(sPrev)) continue;
    if (lNow > sNow && lPrev <= sPrev) out[i] = 'BUY';
    else if (lNow < sNow && lPrev >= sPrev) out[i] = 'SELL';
  }
  return out;
}

/**
 * Bollinger Bands mean-reversion. Long-only:
 *   BUY  when close crosses BELOW lower band (oversold)
 *   SELL when close crosses ABOVE middle band (return to mean) OR touches upper.
 */
function signalBollinger(closes, params) {
  const period = params.period || 20;
  const k      = params.k      || 2;
  const { middle, upper, lower } = bollinger(closes, period, k);
  const out = new Array(closes.length).fill(null);
  for (let i = period + 1; i < closes.length; i++) {
    const cNow = closes[i], cPrev = closes[i - 1];
    const lNow = lower[i],  lPrev = lower[i - 1];
    const mNow = middle[i], mPrev = middle[i - 1];
    if (!Number.isFinite(lNow) || !Number.isFinite(mNow) || !Number.isFinite(lPrev) || !Number.isFinite(mPrev)) continue;
    // BUY when price crosses below lower band
    if (cNow < lNow && cPrev >= lPrev) out[i] = 'BUY';
    // SELL when price crosses above middle band
    else if (cNow > mNow && cPrev <= mPrev) out[i] = 'SELL';
  }
  return out;
}


/**
 * Supertrend -- classic trend-following indicator combining ATR + price.
 *   Lower band = HL/2 - k*ATR, Upper band = HL/2 + k*ATR.
 *   Trend flips up when close > previous upper; flips down when close < previous lower.
 *   BUY on flip-up, SELL on flip-down. Long-only here.
 */
function signalSupertrend(candles, params) {
  const period = params.period || 10;
  const k      = params.multiplier || 3;
  const atrArr = atr(candles, period);
  const out = new Array(candles.length).fill(null);
  let trendUp = true, prevUpper = null, prevLower = null;
  for (let i = period; i < candles.length; i++) {
    const c = candles[i];
    const hl2 = (c.high + c.low) / 2;
    const a = atrArr[i];
    if (!Number.isFinite(a)) continue;
    let upper = hl2 + k * a;
    let lower = hl2 - k * a;
    if (prevUpper != null && candles[i-1].close <= prevUpper) upper = Math.min(upper, prevUpper);
    if (prevLower != null && candles[i-1].close >= prevLower) lower = Math.max(lower, prevLower);
    const wasUp = trendUp;
    if (c.close > prevUpper) trendUp = true;
    else if (c.close < prevLower) trendUp = false;
    if (!wasUp && trendUp) out[i] = 'BUY';
    else if (wasUp && !trendUp) out[i] = 'SELL';
    prevUpper = upper;
    prevLower = lower;
  }
  return out;
}

/**
 * ADX trend filter:
 *   When ADX > threshold AND +DI > -DI -> trending up -> BUY (if flat).
 *   When ADX > threshold AND -DI > +DI -> trending down -> SELL (if long).
 *   When ADX < threshold -> no trade. Long-only.
 */
function signalAdxTrend(candles, params) {
  const period    = params.period    || 14;
  const threshold = params.threshold || 25;
  const a = adx(candles, period);
  const out = new Array(candles.length).fill(null);
  for (let i = period * 2; i < candles.length; i++) {
    const adxV = a.adx[i], pdi = a.plusDi[i], mdi = a.minusDi[i];
    if (!Number.isFinite(adxV)) continue;
    if (adxV > threshold) {
      if (pdi > mdi) out[i] = 'BUY';
      else if (mdi > pdi) out[i] = 'SELL';
    }
  }
  return out;
}

/**
 * Donchian channel breakout:
 *   BUY  when close > rolling N-period high (exclusive of current bar).
 *   SELL when close < rolling N-period low.
 * Classic 'Turtle traders' rule. Trending markets only.
 */
function signalDonchian(candles, params) {
  const period = params.period || 20;
  const out = new Array(candles.length).fill(null);
  for (let i = period; i < candles.length; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period; j < i; j++) {
      if (candles[j].high > hi) hi = candles[j].high;
      if (candles[j].low  < lo) lo = candles[j].low;
    }
    const c = candles[i].close;
    if (c > hi) out[i] = 'BUY';
    else if (c < lo) out[i] = 'SELL';
  }
  return out;
}

/**
 * Stochastic oscillator (slow): K = SMA(raw_k, smoothK); D = SMA(K, smoothD).
 *   BUY  when K crosses above D in oversold region (<oversold).
 *   SELL when K crosses below D in overbought region (>overbought).
 */
function signalStochastic(candles, params) {
  const period      = params.period      || 14;
  const smoothK     = params.smoothK     || 3;
  const smoothD     = params.smoothD     || 3;
  const oversold    = params.oversold    || 20;
  const overbought  = params.overbought  || 80;
  const n = candles.length;
  const rawK = new Array(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].high > hi) hi = candles[j].high;
      if (candles[j].low  < lo) lo = candles[j].low;
    }
    const c = candles[i].close;
    rawK[i] = hi === lo ? 50 : ((c - lo) / (hi - lo)) * 100;
  }
  const sma = (arr, p, i) => {
    let s = 0;
    for (let j = i - p + 1; j <= i; j++) {
      if (!Number.isFinite(arr[j])) return NaN;
      s += arr[j];
    }
    return s / p;
  };
  const k = new Array(n).fill(NaN);
  for (let i = period + smoothK - 2; i < n; i++) k[i] = sma(rawK, smoothK, i);
  const d = new Array(n).fill(NaN);
  for (let i = period + smoothK + smoothD - 3; i < n; i++) d[i] = sma(k, smoothD, i);
  const out = new Array(n).fill(null);
  for (let i = period + smoothK + smoothD; i < n; i++) {
    const kNow = k[i], kPrev = k[i - 1];
    const dNow = d[i], dPrev = d[i - 1];
    if (!Number.isFinite(kNow) || !Number.isFinite(dNow)) continue;
    const crossUp   = kNow > dNow && kPrev <= dPrev;
    const crossDown = kNow < dNow && kPrev >= dPrev;
    if (crossUp && kNow < oversold + 20) out[i] = 'BUY';
    else if (crossDown && kNow > overbought - 20) out[i] = 'SELL';
  }
  return out;
}

/**
 * Williams %R: -100 * (highest_high - close) / (highest_high - lowest_low) over N bars.
 *   Range: -100 (oversold) to 0 (overbought).
 *   BUY  when %R crosses up through oversold threshold (default -80).
 *   SELL when %R crosses down through overbought threshold (default -20).
 */
function signalWilliamsR(candles, params) {
  const period     = params.period     || 14;
  const oversold   = params.oversold   || -80;
  const overbought = params.overbought || -20;
  const n = candles.length;
  const wr = new Array(n).fill(NaN);
  for (let i = period - 1; i < n; i++) {
    let hi = -Infinity, lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].high > hi) hi = candles[j].high;
      if (candles[j].low  < lo) lo = candles[j].low;
    }
    const c = candles[i].close;
    wr[i] = hi === lo ? -50 : -100 * (hi - c) / (hi - lo);
  }
  const out = new Array(n).fill(null);
  for (let i = period + 1; i < n; i++) {
    const w = wr[i], wPrev = wr[i - 1];
    if (!Number.isFinite(w) || !Number.isFinite(wPrev)) continue;
    if (w > oversold   && wPrev <= oversold)   out[i] = 'BUY';
    if (w < overbought && wPrev >= overbought) out[i] = 'SELL';
  }
  return out;
}

/**
 * Heikin-Ashi trend: smoothed candles. BUY when N consecutive HA candles are bullish
 * (HA close > HA open) after a bearish run; SELL after N consecutive bearish HA candles.
 */
function signalHeikinAshi(candles, params) {
  const run = params.run || 3;
  const n = candles.length;
  const haO = new Array(n).fill(NaN);
  const haC = new Array(n).fill(NaN);
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    haC[i] = (c.open + c.high + c.low + c.close) / 4;
    haO[i] = i === 0 ? (c.open + c.close) / 2 : (haO[i-1] + haC[i-1]) / 2;
  }
  const out = new Array(n).fill(null);
  let bullRun = 0, bearRun = 0, lastSig = null;
  for (let i = 1; i < n; i++) {
    const bull = haC[i] > haO[i];
    if (bull) { bullRun++; bearRun = 0; }
    else      { bearRun++; bullRun = 0; }
    if (bullRun === run && lastSig !== 'BUY')   { out[i] = 'BUY';  lastSig = 'BUY';  }
    if (bearRun === run && lastSig !== 'SELL')  { out[i] = 'SELL'; lastSig = 'SELL'; }
  }
  return out;
}

function computeSignal({ candles, strategy, params }) {
  if (!Array.isArray(candles) || candles.length < 30) return [];
  const closes = candles.map(c => c.close);
  params = params || {};
  if (strategy === 'rsi_mean_revert') return signalRsiMeanRevert(closes, params);
  if (strategy === 'ema_cross')       return signalEmaCross(closes, params);
  if (strategy === 'macd_cross')      return signalMacdCross(closes, params);
  if (strategy === 'bollinger')       return signalBollinger(closes, params);
  if (strategy === 'supertrend')      return signalSupertrend(candles, params);
  if (strategy === 'adx_trend')       return signalAdxTrend(candles, params);
  if (strategy === 'donchian')        return signalDonchian(candles, params);
  if (strategy === 'stochastic')      return signalStochastic(candles, params);
  if (strategy === 'williams_r')      return signalWilliamsR(candles, params);
  if (strategy === 'heikin_ashi')     return signalHeikinAshi(candles, params);
  throw new Error('unknown strategy: ' + strategy);
}

module.exports = { runBacktest, computeSignal };

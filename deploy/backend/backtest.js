// backtest.js — strategy simulation on historical candles.
//
// Two built-in strategies (reuses scanner indicator code):
//   1. rsi_mean_revert: BUY when RSI < entryRsi (default 30); SELL when RSI > exitRsi (default 70)
//   2. ema_cross:       BUY when close crosses above N-EMA; SELL when crosses below
//
// Both are long-only (no shorting). One position at a time. Each closed trade
// records entry/exit + P&L. Final report includes win-rate, max drawdown,
// and the equity curve (one point per bar).

const { rsi, ema } = require('./scanner');

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

module.exports = { runBacktest };

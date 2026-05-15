// replay.js -- Tier 27: Historical "Would I have been in this trade?" replay.
//
// Spec §2 Stage 2: "'Would I have been in this trade?' replay mode: pick a
// historical day, step through candles, see signals as they would have fired".
//
// Unlike /api/backtest which returns aggregate trades + final equity, this
// module returns the per-bar timeline:
//   { bars: [{ date, ohlc, signal?, position?, equity }] }
// so the frontend can animate a step-by-step playback.
//
// Public API:
//   const r = new Replay({ computeSignal });
//   r.replay({ candles, strategy, params, qty })

class Replay {
  constructor({ computeSignal }) {
    if (typeof computeSignal !== 'function') throw new Error('computeSignal fn required');
    this.computeSignal = computeSignal;
  }

  /**
   * @param {object} arg
   * @param {Array<{date,open,high,low,close,volume}>} arg.candles
   * @param {string} arg.strategy
   * @param {object} [arg.params]
   * @param {number} [arg.qty]   default 1
   */
  replay({ candles, strategy, params, qty }) {
    if (!Array.isArray(candles) || candles.length < 30) throw new Error('need >= 30 candles');
    qty = qty || 1;
    params = params || {};

    const signals = this.computeSignal({ candles, strategy, params });
    if (!Array.isArray(signals)) throw new Error('signal generator did not return array');

    // Walk bar-by-bar, simulating a long-only position.
    const bars = [];
    let cash = 0;
    let position = null;     // { entryDate, entryPrice }
    let trades = 0, wins = 0, losses = 0, totalPnl = 0;
    let peak = 0, maxDD = 0;

    for (let i = 0; i < candles.length; i++) {
      const c = candles[i];
      const sig = signals[i];

      // Apply signal
      let event = null;
      if (sig === 'BUY' && !position) {
        position = { entryDate: c.date, entryPrice: c.close };
        event = { kind: 'ENTRY', side: 'BUY', price: c.close };
      } else if (sig === 'SELL' && position) {
        const pnl = +((c.close - position.entryPrice) * qty).toFixed(2);
        cash += pnl;
        trades++;
        if (pnl > 0) wins++;
        else if (pnl < 0) losses++;
        totalPnl += pnl;
        event = { kind: 'EXIT', side: 'SELL', price: c.close, pnl };
        position = null;
      }

      // Mark-to-market equity at close
      const unrealized = position ? (c.close - position.entryPrice) * qty : 0;
      const equity = +(cash + unrealized).toFixed(2);
      if (equity > peak) peak = equity;
      const dd = peak - equity;
      if (dd > maxDD) maxDD = dd;

      bars.push({
        i,
        date: c.date,
        ohlc: { o: c.open, h: c.high, l: c.low, c: c.close },
        volume: c.volume,
        signal: sig,
        event,
        position: position ? { since: position.entryDate, entryPrice: position.entryPrice, qty } : null,
        equity,
      });
    }

    // Force-close open position at the last bar for clean accounting
    if (position && candles.length > 0) {
      const last = candles[candles.length - 1];
      const pnl = +((last.close - position.entryPrice) * qty).toFixed(2);
      cash += pnl; trades++;
      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;
      totalPnl += pnl;
      bars[bars.length - 1].event = { kind: 'FORCE_EXIT', side: 'SELL', price: last.close, pnl };
      bars[bars.length - 1].equity = +cash.toFixed(2);
    }

    return {
      ok: true,
      strategy,
      bars,
      stats: {
        bars: candles.length,
        trades,
        wins,
        losses,
        winRate: trades ? +(wins / trades * 100).toFixed(2) : 0,
        totalPnl: +totalPnl.toFixed(2),
        maxDrawdownINR: +maxDD.toFixed(2),
      },
    };
  }
}

module.exports = { Replay };

// g2-mean-reversion.js — T-162 G2: RSI-2 oversold mean-reversion scanner.
//
// Hit when:
//   1. 14-period RSI < 30 (oversold)
//   2. Price > 200-bar SMA (long-term uptrend — only buy dips in uptrends)
//   3. Latest close > latest open (intraday reversal already starting)
//
// Score = (30 - rsi14) * 2 (capped at 30).

'use strict';

const RSI_PERIOD = 14;
const SMA_PERIOD = 200;
const RSI_THRESHOLD = 30;

function computeRSI(bars, period) {
  if (!Array.isArray(bars) || bars.length < period + 1) return null;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const d = Number(bars[i].c) - Number(bars[i - 1].c);
    if (d > 0) gains += d;
    else losses += -d;
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  // Wilder's smoothing for the rest
  for (let i = period + 1; i < bars.length; i++) {
    const d = Number(bars[i].c) - Number(bars[i - 1].c);
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - (100 / (1 + rs));
}

function evaluate(bars, ctx) {
  if (!Array.isArray(bars) || bars.length < SMA_PERIOD) return null;
  const latest = bars[bars.length - 1];
  if (!latest || typeof latest.c !== 'number' || typeof latest.o !== 'number') return null;

  // Long-term trend filter
  const last200 = bars.slice(-SMA_PERIOD);
  const sma200 = last200.reduce((s, b) => s + (Number(b.c) || 0), 0) / last200.length;
  if (latest.c <= sma200) return null;

  // Reversal already starting (avoid catching falling knives)
  if (latest.c <= latest.o) return null;

  // RSI oversold
  const rsi = computeRSI(bars.slice(-RSI_PERIOD * 3), RSI_PERIOD);
  if (rsi == null || rsi >= RSI_THRESHOLD) return null;

  return {
    hit: true,
    score: Math.min(30, +((RSI_THRESHOLD - rsi) * 2).toFixed(2)),
    note: `RSI(14)=${rsi.toFixed(1)} in uptrend (close > SMA200)`,
  };
}

module.exports = {
  name: 'g2-mean-reversion',
  label: 'RSI-2 oversold',
  description: 'RSI(14)<30 + close>SMA200 + intraday reversal',
  evaluate,
};

// g10-atr-expansion.js — ATR (Average True Range) expansion detection.
//
// Opposite signal to g9 (squeeze): hit when today's true range is
// significantly larger than the 20-bar avg ATR. Indicates volatility has
// just kicked in — useful for "the breakout has fired" entries (vs
// pre-emptive squeeze setups).
//
// True range for bar i = max(h-l, |h-prevClose|, |l-prevClose|).
// Hit when today's TR > 1.5× 20-bar avg ATR.

'use strict';

const PERIOD = 20;
const MULT = 1.5;

function trueRange(today, prior) {
  const hl = Number(today.h) - Number(today.l);
  const hPc = Math.abs(Number(today.h) - Number(prior.c));
  const lPc = Math.abs(Number(today.l) - Number(prior.c));
  return Math.max(hl, hPc, lPc);
}

function evaluate(bars) {
  if (!Array.isArray(bars) || bars.length < PERIOD + 2) return null;
  const today = bars[bars.length - 1];
  const yest  = bars[bars.length - 2];
  if (!today || !yest) return null;

  // 20-bar avg ATR over bars [N-22..N-2] (excluding today)
  const window = bars.slice(-PERIOD - 2, -1);
  let sum = 0, count = 0;
  for (let i = 1; i < window.length; i++) {
    const tr = trueRange(window[i], window[i - 1]);
    if (Number.isFinite(tr)) { sum += tr; count++; }
  }
  if (count === 0) return null;
  const avgAtr = sum / count;
  if (avgAtr <= 0) return null;

  const todayTr = trueRange(today, yest);
  if (!Number.isFinite(todayTr) || todayTr < avgAtr * MULT) return null;

  const ratio = todayTr / avgAtr;
  return {
    hit: true,
    score: +Math.min(20, (ratio - 1) * 10).toFixed(2),
    note: `TR ${todayTr.toFixed(2)} = ${ratio.toFixed(2)}× 20-bar avg ATR ${avgAtr.toFixed(2)}`,
  };
}

module.exports = {
  name: 'g10-atr-expansion',
  label: 'ATR expansion',
  description: "Today's TR > 1.5× 20-bar avg ATR — volatility kick",
  evaluate,
};

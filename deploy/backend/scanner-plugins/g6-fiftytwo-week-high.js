// g6-fiftytwo-week-high.js — 52-week high breakout on confirmed volume.
//
// "52-week" is canonically 252 trading bars (≈ 1y NSE). Hit when today's
// close >= the max close of the last 252 prior bars (excluding today)
// AND volume is at least 1.3× the 50-bar avg volume.

'use strict';

const WINDOW = 252;
const VOL_PERIOD = 50;
const VOL_MULT = 1.3;

function evaluate(bars) {
  if (!Array.isArray(bars) || bars.length < Math.max(WINDOW, VOL_PERIOD) + 1) return null;
  const recent = bars.slice(-WINDOW - 1);
  const today = recent[recent.length - 1];
  const prior = recent.slice(0, -1);
  if (!today || prior.length < WINDOW) return null;

  let priorMax = -Infinity;
  for (const b of prior) {
    const c = Number(b.c);
    if (Number.isFinite(c) && c > priorMax) priorMax = c;
  }
  if (today.c < priorMax) return null;   // not at/above 52w high

  // Volume confirmation over the last 50 bars (excluding today).
  const vol50 = bars.slice(-VOL_PERIOD - 1, -1);
  const avgVol = vol50.reduce((s, b) => s + (Number(b.v) || 0), 0) / vol50.length;
  if (avgVol <= 0 || Number(today.v) < avgVol * VOL_MULT) return null;

  const score = Math.min(20, ((today.c - priorMax) / priorMax) * 100 + 5);
  return {
    hit: true,
    score: +score.toFixed(2),
    note: `52w high ${today.c.toFixed(2)} (prev ${priorMax.toFixed(2)}) on ${((Number(today.v) || 0) / avgVol).toFixed(1)}× vol`,
  };
}

module.exports = {
  name: 'g6-fiftytwo-week-high',
  label: '52-week high',
  description: 'Close at new 252-bar high with >=1.3× 50-bar avg volume',
  evaluate,
};

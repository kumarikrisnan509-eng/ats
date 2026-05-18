// g1-momentum.js — T-162 G1: classic momentum breakout scanner.
//
// Hit when:
//   1. Latest close > 20-bar SMA (trend up)
//   2. Latest close > previous 20-bar high (breakout)
//   3. Volume in latest bar > 1.5× 20-bar avg volume (confirmation)
//
// Score = (close - sma20) / sma20 in percent (positive only, capped at 25).
// Note = "{close:0.00} cleared {prev_high:0.00} on {volMult:0.0}× vol".

'use strict';

const PERIOD = 20;
const VOL_MULT = 1.5;

function evaluate(bars, ctx) {
  if (!Array.isArray(bars) || bars.length < PERIOD + 1) return null;

  // Use most recent PERIOD+1 bars for context.
  const recent = bars.slice(-PERIOD - 1);
  const latest = recent[recent.length - 1];
  const prior  = recent.slice(0, -1);   // previous PERIOD bars

  if (!latest || typeof latest.c !== 'number') return null;
  if (prior.length < PERIOD) return null;

  // 20-bar SMA (excluding latest)
  const sumClose = prior.reduce((s, b) => s + (Number(b.c) || 0), 0);
  const sma20 = sumClose / prior.length;
  if (sma20 <= 0) return null;

  // 20-bar prior high
  let priorHigh = -Infinity;
  for (const b of prior) {
    const h = Number(b.h);
    if (Number.isFinite(h) && h > priorHigh) priorHigh = h;
  }

  // 20-bar avg volume (excluding latest)
  const sumVol = prior.reduce((s, b) => s + (Number(b.v) || 0), 0);
  const avgVol = sumVol / prior.length;

  const trendUp     = latest.c > sma20;
  const brokeOut    = latest.c > priorHigh;
  const volConfirm  = avgVol > 0 ? (Number(latest.v) || 0) >= avgVol * VOL_MULT : false;

  if (!(trendUp && brokeOut && volConfirm)) return null;

  const score = Math.min(25, ((latest.c - sma20) / sma20) * 100);
  return {
    hit: true,
    score: +score.toFixed(2),
    note: `${latest.c.toFixed(2)} cleared ${priorHigh.toFixed(2)} on ${((latest.v || 0) / avgVol).toFixed(1)}× vol`,
  };
}

module.exports = {
  name: 'g1-momentum',
  label: 'Momentum breakout',
  description: '20-bar SMA + prior-high break + 1.5× vol',
  evaluate,
};

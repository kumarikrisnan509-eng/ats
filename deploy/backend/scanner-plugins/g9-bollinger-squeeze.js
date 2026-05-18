// g9-bollinger-squeeze.js — Bollinger band width contraction.
//
// Classic "squeeze" — when 20-bar BB width is at a 6-month low, volatility
// is coiling and a breakout is statistically likely soon.
//
// Hit when: today's BB-width = (UB - LB) / SMA20 is the LOWEST in the last 120 bars.
//
// We don't predict direction here — just flag the setup. The AI critic
// downstream will combine this with trend / volume context.

'use strict';

const PERIOD = 20;
const WINDOW = 120;
const STDDEV = 2;

function bbWidth(closes) {
  if (closes.length < PERIOD) return null;
  const slice = closes.slice(-PERIOD);
  const mean = slice.reduce((s, c) => s + c, 0) / PERIOD;
  const variance = slice.reduce((s, c) => s + (c - mean) ** 2, 0) / PERIOD;
  const sd = Math.sqrt(variance);
  return mean > 0 ? (2 * STDDEV * sd) / mean : null;   // width as fraction of mean
}

function evaluate(bars) {
  if (!Array.isArray(bars) || bars.length < PERIOD + WINDOW) return null;
  const closes = bars.map(b => Number(b.c)).filter(Number.isFinite);
  if (closes.length < PERIOD + WINDOW) return null;

  const todayWidth = bbWidth(closes);
  if (todayWidth == null) return null;

  // Compute width at each of the last WINDOW bars and find the min
  let minWidth = Infinity;
  for (let i = closes.length - WINDOW; i < closes.length; i++) {
    const w = bbWidth(closes.slice(0, i + 1));
    if (w != null && w < minWidth) minWidth = w;
  }
  if (todayWidth > minWidth) return null;   // not at min

  return {
    hit: true,
    score: +Math.min(20, 100 - todayWidth * 1000).toFixed(2),   // smaller width = higher score
    note: `BB-width ${(todayWidth * 100).toFixed(2)}% — ${WINDOW}-bar low; coiled`,
  };
}

module.exports = {
  name: 'g9-bollinger-squeeze',
  label: 'Bollinger squeeze',
  description: '20-bar BB width at 120-bar low — vol compression',
  evaluate,
};

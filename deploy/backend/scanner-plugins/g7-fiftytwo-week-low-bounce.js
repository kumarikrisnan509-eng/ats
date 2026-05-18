// g7-fiftytwo-week-low-bounce.js — bounce off 52-week low.
//
// Hit when:
//   1. Today's LOW touched or undercut the 252-bar prior min low
//   2. Today's CLOSE recovered >2% off that low (intraday reversal)
//   3. Volume confirms (>=1.5× 50-bar avg) — capitulation+absorption pattern

'use strict';

const WINDOW = 252;
const VOL_PERIOD = 50;
const VOL_MULT = 1.5;
const MIN_BOUNCE_PCT = 2;

function evaluate(bars) {
  if (!Array.isArray(bars) || bars.length < Math.max(WINDOW, VOL_PERIOD) + 1) return null;
  const recent = bars.slice(-WINDOW - 1);
  const today = recent[recent.length - 1];
  const prior = recent.slice(0, -1);
  if (!today || prior.length < WINDOW) return null;

  let priorMinLow = Infinity;
  for (const b of prior) {
    const l = Number(b.l);
    if (Number.isFinite(l) && l < priorMinLow) priorMinLow = l;
  }
  // Today's low must touch or undercut the prior min
  if (Number(today.l) > priorMinLow) return null;
  // Close must bounce >MIN_BOUNCE_PCT off today's low
  const bouncePct = ((Number(today.c) - Number(today.l)) / Number(today.l)) * 100;
  if (!Number.isFinite(bouncePct) || bouncePct < MIN_BOUNCE_PCT) return null;

  // Volume confirmation
  const vol50 = bars.slice(-VOL_PERIOD - 1, -1);
  const avgVol = vol50.reduce((s, b) => s + (Number(b.v) || 0), 0) / vol50.length;
  if (avgVol <= 0 || Number(today.v) < avgVol * VOL_MULT) return null;

  return {
    hit: true,
    score: +Math.min(25, bouncePct * 3).toFixed(2),
    note: `52w-low ${priorMinLow.toFixed(2)} touched; closed +${bouncePct.toFixed(2)}% on ${((Number(today.v) || 0) / avgVol).toFixed(1)}× vol`,
  };
}

module.exports = {
  name: 'g7-fiftytwo-week-low-bounce',
  label: '52-week low bounce',
  description: 'Touched 252-bar low, closed >2% off low on confirming volume',
  evaluate,
};

// g4-nr7.js — Narrow Range 7-day (volatility contraction precedes expansion).
//
// Hit when today's high-low range is the smallest of the last 7 bars.
// Classic Toby Crabel pattern: NR7 days often precede large directional moves.
//
// Score = ratio (avg7 - todayRange) / avg7 * 100, capped at 30.

'use strict';

function evaluate(bars) {
  if (!Array.isArray(bars) || bars.length < 7) return null;
  const last7 = bars.slice(-7);
  const ranges = last7.map(b => Number(b.h) - Number(b.l));
  if (ranges.some(r => !Number.isFinite(r) || r < 0)) return null;
  const today = ranges[ranges.length - 1];
  // Is today's range strictly the smallest? (NR7 by definition)
  for (let i = 0; i < ranges.length - 1; i++) {
    if (ranges[i] <= today) return null;
  }
  const avg = ranges.reduce((s, r) => s + r, 0) / ranges.length;
  const score = avg > 0 ? Math.min(30, ((avg - today) / avg) * 100) : 0;
  return {
    hit: true,
    score: +score.toFixed(2),
    note: `range ${today.toFixed(2)} is smallest of last 7 (avg ${avg.toFixed(2)})`,
  };
}

module.exports = {
  name: 'g4-nr7',
  label: 'NR7 narrow range',
  description: "Today's range is smallest of last 7 — coiled spring",
  evaluate,
};

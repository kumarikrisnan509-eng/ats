// g3-gap-fade.js — gap-and-go OR gap-fade detection.
//
// Hit when the open gaps >=1% from the prior close AND:
//   - direction='up': open > prior close * 1.01 (gap up — fade if close < open,
//     continuation if close > open)
//   - we return either reversal or continuation as `note`
//
// Score = abs(gap %) capped at 10.

'use strict';

function evaluate(bars) {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const today = bars[bars.length - 1];
  const prior = bars[bars.length - 2];
  if (!today || !prior) return null;
  const gapPct = (Number(today.o) - Number(prior.c)) / Number(prior.c) * 100;
  if (!Number.isFinite(gapPct) || Math.abs(gapPct) < 1) return null;

  const isFade = gapPct > 0 ? (today.c < today.o) : (today.c > today.o);
  const direction = isFade ? 'fade' : 'continuation';

  return {
    hit: true,
    score: Math.min(10, +Math.abs(gapPct).toFixed(2)),
    note: `${gapPct > 0 ? 'gap-up' : 'gap-down'} ${gapPct.toFixed(2)}% — ${direction}`,
  };
}

module.exports = {
  name: 'g3-gap-fade',
  label: 'Gap fade/continuation',
  description: '|open-priorClose| >= 1%; classifies fade vs continuation',
  evaluate,
};

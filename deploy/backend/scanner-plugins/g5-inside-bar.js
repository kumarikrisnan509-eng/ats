// g5-inside-bar.js — Inside-bar breakout.
//
// Hit when:
//   - Today's high < yesterday's high AND today's low > yesterday's low
//     (today's range is fully INSIDE yesterday's — coiled compression)
//   - AND today's close breaks out either above yesterday's high
//     or below yesterday's low (direction stamped in note)
//
// Note: pure inside-bar without break returns null. We want the resolution,
// not just the setup. Use g4-nr7 for the setup-only version.

'use strict';

function evaluate(bars) {
  if (!Array.isArray(bars) || bars.length < 2) return null;
  const t = bars[bars.length - 1];
  const y = bars[bars.length - 2];
  if (!t || !y) return null;
  const insideRange = t.h < y.h && t.l > y.l;
  if (!insideRange) return null;
  // Today's close must break yesterday's range to count.
  const brokeUp   = t.c > y.h;
  const brokeDown = t.c < y.l;
  if (!brokeUp && !brokeDown) return null;
  const direction = brokeUp ? 'up' : 'down';
  const pct = Math.abs((t.c - y.c) / y.c) * 100;
  return {
    hit: true,
    score: +Math.min(15, pct).toFixed(2),
    note: `inside-bar ${direction}-break ${pct.toFixed(2)}%`,
  };
}

module.exports = {
  name: 'g5-inside-bar',
  label: 'Inside-bar breakout',
  description: 'Today inside yesterday + closing break of yesterday range',
  evaluate,
};

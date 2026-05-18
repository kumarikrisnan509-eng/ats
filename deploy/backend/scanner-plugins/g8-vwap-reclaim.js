// g8-vwap-reclaim.js — intraday VWAP reclaim setup.
//
// VWAP isn't directly in our OHLC bars (which are daily by default), but
// we approximate intraday VWAP using the typical price ((H+L+C)/3) over
// the last N bars weighted by volume. Hit when:
//   1. Today's low DIPPED below approximate VWAP (intraday weakness)
//   2. Today's close CLOSED above approximate VWAP (reclaim)
//   3. Volume >= 20-bar avg (any kind of confirmation)
//
// This is best-effort on daily bars; the real implementation would use
// 1-minute intraday data. Documenting the approximation here so callers
// know what they're getting.

'use strict';

const WINDOW = 20;
const VOL_PERIOD = 20;

function evaluate(bars) {
  if (!Array.isArray(bars) || bars.length < WINDOW) return null;
  const today = bars[bars.length - 1];
  if (!today) return null;

  // Approximate VWAP over the window (rolling, volume-weighted typical price).
  const recent = bars.slice(-WINDOW);
  let num = 0, den = 0;
  for (const b of recent) {
    const tp = (Number(b.h) + Number(b.l) + Number(b.c)) / 3;
    const v = Number(b.v) || 0;
    if (!Number.isFinite(tp) || v <= 0) continue;
    num += tp * v;
    den += v;
  }
  if (den <= 0) return null;
  const vwap = num / den;

  // 1. Today dipped below approx-VWAP
  if (Number(today.l) >= vwap) return null;
  // 2. Today closed back above approx-VWAP
  if (Number(today.c) <= vwap) return null;
  // 3. Volume confirmation
  const vol20 = bars.slice(-VOL_PERIOD - 1, -1);
  const avgVol = vol20.reduce((s, b) => s + (Number(b.v) || 0), 0) / vol20.length;
  if (avgVol <= 0 || Number(today.v) < avgVol) return null;

  const reclaimPct = ((Number(today.c) - vwap) / vwap) * 100;
  return {
    hit: true,
    score: +Math.min(20, reclaimPct * 5).toFixed(2),
    note: `dipped to ${Number(today.l).toFixed(2)}, reclaimed VWAP ~${vwap.toFixed(2)} (close ${Number(today.c).toFixed(2)})`,
  };
}

module.exports = {
  name: 'g8-vwap-reclaim',
  label: 'VWAP reclaim',
  description: 'Approx VWAP touched-and-reclaimed (daily approximation)',
  evaluate,
};

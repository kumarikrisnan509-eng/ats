// factor-tilt.js -- Tier 31: factor-tilt portfolio construction.
//
// Spec §2 Stage 5 (deferred from Tier 22 MPT):
//   "Portfolio construction -- factor tilts (momentum / value / quality / low-vol / size)
//    over user-selected universe, long-only or cash-neutral long-short."
//
// Why a separate module from mpt.js:
//   MPT requires expected-returns + covariance, which most retail users don't have.
//   Factor tilt only needs raw fundamental/price metrics (which the broker API + a
//   90d price history already give us) and produces a portfolio with controlled
//   exposure to well-documented risk premia. This is what AQR, DFA, Acadian use.
//
// Public API:
//   const ft = new FactorTilt();
//   ft.build({ universe, factorWeights, mode: 'long-only' | 'long-short',
//              topPct: 0.2, bottomPct: 0.2 })
//
// Input:
//   universe: [{ symbol, momentum, value, quality, lowVol, size, marketCap }, ...]
//     - momentum: 12-1m return (decimal). Higher = better.
//     - value:    1 / (P/E ratio). Higher = cheaper.
//     - quality:  ROE (decimal). Higher = better.
//     - lowVol:   1 / 90d realized volatility. Higher = lower vol.
//     - size:     1 / log(marketCap). Higher = smaller.
//     - marketCap: INR. Used for sanity caps; not directly scored.
//   factorWeights: { momentum:0.4, value:0.3, quality:0.2, lowVol:0.1, size:0 }
//     - Must sum to 1.0 (within 0.001 tolerance). Negative weights allowed (tilt against).
//   mode: 'long-only' (default) or 'long-short'
//   topPct:    fraction of universe to long (default 0.2 = top quintile)
//   bottomPct: fraction of universe to short (long-short only, default 0.2)
//
// Output (long-only):
//   { ok:true, mode, longs:[{symbol, weight, compositeZ, factors:{...}}, ...],
//     portfolioExposure: { momentum, value, quality, lowVol, size },
//     stats: { universeSize, longCount, sumWeights } }
//
// Output (long-short):
//   { ok:true, mode, longs:[...], shorts:[{symbol, weight, ...}],
//     portfolioExposure: {...}, stats: { universeSize, longCount, shortCount, gross, net } }
//
// Algorithm:
//   1. Validate inputs.
//   2. Compute z-score per factor across the universe (cross-sectional).
//   3. Composite z-score per stock = sum(factorWeight_k * zScore_k).
//   4. Sort universe by composite z descending.
//   5. Long top topPct (by count, rounded up to >=2).
//      - Long-only:   weights = softmax(z_long * 5)  -- gentle tilt toward higher z.
//      - Long-short:  long side equal-weighted, short side equal-weighted, net = 0.
//   6. Report portfolio's average factor exposure (weighted z-scores).

const FACTORS = ['momentum', 'value', 'quality', 'lowVol', 'size'];

class FactorTilt {
  constructor() {}

  /**
   * @param {object} arg
   * @param {Array<{symbol:string, momentum?:number, value?:number, quality?:number,
   *                lowVol?:number, size?:number, marketCap?:number}>} arg.universe
   * @param {Partial<Record<'momentum'|'value'|'quality'|'lowVol'|'size', number>>} arg.factorWeights
   * @param {'long-only'|'long-short'} [arg.mode]   default 'long-only'
   * @param {number} [arg.topPct]                   default 0.2
   * @param {number} [arg.bottomPct]                default 0.2 (long-short only)
   */
  build({ universe, factorWeights, mode, topPct, bottomPct }) {
    // ---- 1. Validate ----
    if (!Array.isArray(universe) || universe.length < 5) {
      throw new Error('universe must have at least 5 stocks');
    }
    if (universe.length > 500) {
      throw new Error('universe too large (max 500 stocks)');
    }
    if (!factorWeights || typeof factorWeights !== 'object') {
      throw new Error('factorWeights required');
    }
    const w = {};
    let wsum = 0;
    for (const f of FACTORS) {
      const v = Number(factorWeights[f]);
      w[f] = Number.isFinite(v) ? v : 0;
      wsum += w[f];
    }
    if (Math.abs(wsum - 1.0) > 0.001) {
      throw new Error(`factorWeights must sum to 1.0 (got ${wsum.toFixed(4)})`);
    }
    const m = mode || 'long-only';
    if (m !== 'long-only' && m !== 'long-short') {
      throw new Error(`mode must be 'long-only' or 'long-short' (got ${m})`);
    }
    const tp = Number.isFinite(topPct) ? Number(topPct) : 0.2;
    const bp = Number.isFinite(bottomPct) ? Number(bottomPct) : 0.2;
    if (tp <= 0 || tp > 0.5) throw new Error('topPct must be in (0, 0.5]');
    if (m === 'long-short' && (bp <= 0 || bp > 0.5)) throw new Error('bottomPct must be in (0, 0.5]');

    // ---- 2. Z-score each factor ----
    const factorValues = {};
    for (const f of FACTORS) {
      factorValues[f] = universe.map(u => Number.isFinite(u[f]) ? Number(u[f]) : null);
    }
    const stats = {};
    for (const f of FACTORS) {
      const vals = factorValues[f].filter(v => v !== null);
      if (vals.length === 0) { stats[f] = { mean: 0, sd: 0 }; continue; }
      const mean = vals.reduce((s, v) => s + v, 0) / vals.length;
      const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
      stats[f] = { mean, sd: sd > 1e-9 ? sd : 1 };
    }

    // ---- 3. Composite z per stock ----
    const scored = universe.map((u, i) => {
      let composite = 0;
      const factorZ = {};
      for (const f of FACTORS) {
        const raw = factorValues[f][i];
        const z = raw === null ? 0 : (raw - stats[f].mean) / stats[f].sd;
        factorZ[f] = z;
        composite += w[f] * z;
      }
      return {
        symbol: String(u.symbol || ''),
        compositeZ: composite,
        factors: factorZ,
        marketCap: Number(u.marketCap) || null,
      };
    }).filter(s => s.symbol);

    // ---- 4. Sort by composite z descending ----
    scored.sort((a, b) => b.compositeZ - a.compositeZ);

    // ---- 5. Build portfolio ----
    const longCount = Math.max(2, Math.ceil(scored.length * tp));
    const longs = scored.slice(0, longCount);

    if (m === 'long-only') {
      // Softmax(z*5) tilt toward higher composite z, but keep all weights positive.
      const exps = longs.map(s => Math.exp(s.compositeZ * 5));
      const sumExp = exps.reduce((s, v) => s + v, 0);
      const weighted = longs.map((s, i) => ({
        symbol: s.symbol,
        weight: exps[i] / sumExp,
        compositeZ: s.compositeZ,
        factors: s.factors,
      }));
      const exposure = this._weightedExposure(weighted, weighted.map(x => x.weight));
      const sumWeights = weighted.reduce((s, x) => s + x.weight, 0);
      return {
        ok: true,
        mode: 'long-only',
        longs: weighted,
        portfolioExposure: exposure,
        stats: {
          universeSize: scored.length,
          longCount: weighted.length,
          sumWeights: Number(sumWeights.toFixed(6)),
        },
      };
    }

    // long-short: equal-weight each side, net exposure = 0.
    const shortCount = Math.max(2, Math.ceil(scored.length * bp));
    const shorts = scored.slice(-shortCount);
    const longW  = 1 / longCount;
    const shortW = 1 / shortCount;
    const longsOut = longs.map(s => ({
      symbol: s.symbol, weight: longW, compositeZ: s.compositeZ, factors: s.factors,
    }));
    const shortsOut = shorts.map(s => ({
      symbol: s.symbol, weight: -shortW, compositeZ: s.compositeZ, factors: s.factors,
    }));
    // Exposure = long-side weighted avg minus short-side weighted avg
    const longExposure  = this._weightedExposure(longsOut,  longsOut.map(x => x.weight));
    const shortExposure = this._weightedExposure(shortsOut, shortsOut.map(x => Math.abs(x.weight)));
    const netExposure = {};
    for (const f of FACTORS) {
      netExposure[f] = Number(((longExposure[f] || 0) - (shortExposure[f] || 0)).toFixed(4));
    }
    return {
      ok: true,
      mode: 'long-short',
      longs:  longsOut,
      shorts: shortsOut,
      portfolioExposure: netExposure,
      stats: {
        universeSize: scored.length,
        longCount:    longsOut.length,
        shortCount:   shortsOut.length,
        gross: Number((1 + 1).toFixed(2)),   // 200% gross (100 long + 100 short)
        net:   0,
      },
    };
  }

  /** Weighted-average factor z-scores across positions. */
  _weightedExposure(positions, weights) {
    const out = {};
    const totalW = weights.reduce((s, v) => s + v, 0) || 1;
    for (const f of FACTORS) {
      let sum = 0;
      for (let i = 0; i < positions.length; i++) {
        sum += weights[i] * (positions[i].factors[f] || 0);
      }
      out[f] = Number((sum / totalW).toFixed(4));
    }
    return out;
  }
}

module.exports = { FactorTilt, FACTORS };

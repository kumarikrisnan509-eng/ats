// mpt.js -- Modern Portfolio Theory optimiser (Tier 22).
//
// Spec §2 Stage 5: "Portfolio construction -- Modern Portfolio Theory optimiser
// over user-selected universe, rebalance suggestions."
//
// This module accepts a small universe (N<=10 assets) with expected returns and
// a covariance matrix, then computes:
//   - max-Sharpe weights      (tangency portfolio)
//   - min-variance weights
//   - the full efficient frontier (sampled at 25 points)
//
// Uses Monte Carlo random sampling for robustness on small universes -- no
// matrix inversion needed, no quadprog dependency. For N <= 10 and 50k samples
// this runs in <100ms.
//
// Public API:
//   const mpt = new MPT();
//   mpt.optimize({ symbols, expectedReturns, covMatrix, riskFreeRate })
//
// Input shape:
//   { symbols:        ['NIFTYBEES','PARAGPARIKH','GOLDBEES'],
//     expectedReturns: [0.12, 0.14, 0.08],          // annual decimals
//     covMatrix:       [[0.02,0.005,0.001],...],    // annual covariance
//     riskFreeRate:    0.07                          // annual decimal, default 0.07 }
//
// Output:
//   { ok: true,
//     symbols,
//     maxSharpe:     { weights:[], expectedReturn, volatility, sharpe },
//     minVariance:   { weights:[], expectedReturn, volatility, sharpe },
//     frontier:      [{ weights, expectedReturn, volatility, sharpe }, ... 25 points] }

class MPT {
  constructor() {}

  /**
   * @param {object} arg
   * @param {string[]}      arg.symbols
   * @param {number[]}      arg.expectedReturns -- annual returns as decimals
   * @param {number[][]}    arg.covMatrix       -- annual covariance N x N
   * @param {number}        [arg.riskFreeRate]  -- default 0.07
   * @param {number}        [arg.samples]       -- default 50000
   */
  optimize({ symbols, expectedReturns, covMatrix, riskFreeRate, samples }) {
    if (!Array.isArray(symbols) || symbols.length < 2) throw new Error('need >= 2 symbols');
    if (symbols.length > 10) throw new Error('max 10 symbols (Monte Carlo perf budget)');
    const n = symbols.length;
    if (!Array.isArray(expectedReturns) || expectedReturns.length !== n) throw new Error('expectedReturns length mismatch');
    if (!Array.isArray(covMatrix) || covMatrix.length !== n) throw new Error('covMatrix dims mismatch');
    for (const row of covMatrix) {
      if (!Array.isArray(row) || row.length !== n) throw new Error('covMatrix not square');
    }
    const rf = Number.isFinite(riskFreeRate) ? riskFreeRate : 0.07;
    const numSamples = Math.max(1000, Math.min(200000, Number(samples) || 50000));

    // ---- Sample random weight vectors on the simplex (sum=1, all >= 0) ----
    const candidates = [];
    for (let i = 0; i < numSamples; i++) {
      const w = this._randomDirichlet(n);
      const ret = this._dot(w, expectedReturns);
      const vol = Math.sqrt(this._quadForm(w, covMatrix));
      const sharpe = vol > 0 ? (ret - rf) / vol : -Infinity;
      candidates.push({ weights: w, expectedReturn: ret, volatility: vol, sharpe });
    }

    // ---- Pick max-Sharpe and min-variance ----
    let maxSharpe = candidates[0];
    let minVar    = candidates[0];
    for (const c of candidates) {
      if (c.sharpe > maxSharpe.sharpe) maxSharpe = c;
      if (c.volatility < minVar.volatility) minVar = c;
    }

    // ---- Sample 25 frontier points evenly across the volatility range ----
    const minVol = minVar.volatility;
    const maxVol = Math.max(...candidates.map(c => c.volatility));
    const buckets = 25;
    const frontier = [];
    for (let b = 0; b < buckets; b++) {
      const lo = minVol + (maxVol - minVol) * (b / buckets);
      const hi = minVol + (maxVol - minVol) * ((b + 1) / buckets);
      const inBucket = candidates.filter(c => c.volatility >= lo && c.volatility < hi);
      if (inBucket.length === 0) continue;
      // Pick the candidate in this bucket with highest expected return
      let best = inBucket[0];
      for (const c of inBucket) if (c.expectedReturn > best.expectedReturn) best = c;
      frontier.push(this._roundResult(best));
    }

    return {
      ok: true,
      symbols,
      maxSharpe:    this._roundResult(maxSharpe),
      minVariance:  this._roundResult(minVar),
      frontier,
      samples: numSamples,
      riskFreeRate: rf,
    };
  }

  // ---- helpers ----
  _randomDirichlet(n) {
    // Sample uniformly from simplex via exponential trick
    const e = new Array(n);
    let s = 0;
    for (let i = 0; i < n; i++) {
      e[i] = -Math.log(Math.random() || 1e-9);
      s += e[i];
    }
    for (let i = 0; i < n; i++) e[i] /= s;
    return e;
  }
  _dot(a, b) {
    let s = 0;
    for (let i = 0; i < a.length; i++) s += a[i] * b[i];
    return s;
  }
  _quadForm(w, cov) {
    // w^T * cov * w
    const n = w.length;
    let s = 0;
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) s += w[i] * cov[i][j] * w[j];
    }
    return s;
  }
  _roundResult(r) {
    return {
      weights: r.weights.map(w => Number(w.toFixed(4))),
      expectedReturn: Number(r.expectedReturn.toFixed(4)),
      volatility: Number(r.volatility.toFixed(4)),
      sharpe: Number(r.sharpe.toFixed(3)),
    };
  }
}

module.exports = { MPT };

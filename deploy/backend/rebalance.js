// rebalance.js -- Tier 23: Bucket-target rebalancing engine.
//
// Spec §2 Stage 5: "Rebalancing -- calendar-based or threshold-based, with
// tax-aware trade lists (LTCG harvesting)".
//
// This module compares current holdings (Kite equity + paper trading + cash)
// against the user's bucket targets (from longterm.getBuckets()) and emits
// trade suggestions to bring allocation back to target.
//
// We don't classify which specific instrument is "long-term" vs "short-term"
// because that's user-tag-dependent. Instead we treat:
//   - long-term portfolio holdings (Kite holdings) -> longTerm bucket
//   - paper trading equity                          -> shortTerm bucket
//   - cash & sweep ready                            -> emergency bucket
//
// Output is suggestions only -- no orders placed.

class Rebalance {
  /**
   * @param {object} arg
   * @param {object} arg.buckets   { emergency, shortTerm, longTerm }  -- target %s
   * @param {number} arg.holdingsValueINR  -- current long-term portfolio value
   * @param {number} arg.paperEquityINR    -- current paper trading equity
   * @param {number} arg.cashINR           -- liquid cash + emergency reserves
   * @param {number} [arg.thresholdPct]    -- default 5 = trigger if any bucket is >=5% off target
   * @returns {object}
   */
  suggest({ buckets, holdingsValueINR, paperEquityINR, cashINR, thresholdPct }) {
    if (!buckets || typeof buckets !== 'object') throw new Error('buckets required');
    const targets = {
      emergency:  Math.max(0, Number(buckets.emergency)  || 0),
      shortTerm:  Math.max(0, Number(buckets.shortTerm)  || 0),
      longTerm:   Math.max(0, Number(buckets.longTerm)   || 0),
    };
    const hold = Math.max(0, Number(holdingsValueINR) || 0);
    const paper = Math.max(0, Number(paperEquityINR) || 0);
    const cash = Math.max(0, Number(cashINR) || 0);
    const thresh = Number.isFinite(thresholdPct) ? thresholdPct : 5;

    const total = hold + paper + cash;
    if (total <= 0) {
      return {
        ok: true, total: 0,
        current: { emergency: 0, shortTerm: 0, longTerm: 0 },
        target: targets,
        drift: {},
        suggestions: [],
        triggered: false,
        thresholdPct: thresh,
        note: 'No capital to rebalance.',
      };
    }

    // Current allocation %s
    const current = {
      emergency: +(cash / total * 100).toFixed(2),
      shortTerm: +(paper / total * 100).toFixed(2),
      longTerm:  +(hold / total * 100).toFixed(2),
    };

    // Drift = current - target
    const drift = {
      emergency: +(current.emergency - targets.emergency).toFixed(2),
      shortTerm: +(current.shortTerm - targets.shortTerm).toFixed(2),
      longTerm:  +(current.longTerm  - targets.longTerm).toFixed(2),
    };

    const triggered = Object.values(drift).some(d => Math.abs(d) >= thresh);

    // INR moves to hit target
    const targetINR = {
      emergency: total * targets.emergency / 100,
      shortTerm: total * targets.shortTerm / 100,
      longTerm:  total * targets.longTerm  / 100,
    };
    const currentINR = { emergency: cash, shortTerm: paper, longTerm: hold };

    const suggestions = [];
    // Excess in one bucket needs to move into deficit bucket(s)
    for (const k of ['emergency', 'shortTerm', 'longTerm']) {
      const deltaINR = +(targetINR[k] - currentINR[k]).toFixed(0);
      if (Math.abs(deltaINR) < 1000) continue;  // ignore <₹1k noise
      suggestions.push({
        bucket: k,
        action: deltaINR > 0 ? 'INCREASE' : 'DECREASE',
        amountINR: Math.abs(deltaINR),
        from: deltaINR > 0 ? null : { fromBucket: k },
        to:   deltaINR > 0 ? { toBucket: k } : null,
        rationale: deltaINR > 0
          ? `Bucket ${k} is ${Math.abs(drift[k]).toFixed(1)}% below target; add ₹${Math.abs(deltaINR).toLocaleString('en-IN')}`
          : `Bucket ${k} is ${Math.abs(drift[k]).toFixed(1)}% above target; trim ₹${Math.abs(deltaINR).toLocaleString('en-IN')}`,
      });
    }

    // Specific action mapping per bucket
    const concreteActions = suggestions.map(s => {
      if (s.bucket === 'longTerm' && s.action === 'INCREASE') {
        return { ...s, suggestedHow: `Buy NIFTYBEES or your SIP target with ₹${s.amountINR.toLocaleString('en-IN')}` };
      }
      if (s.bucket === 'longTerm' && s.action === 'DECREASE') {
        return { ...s, suggestedHow: `Trim equity holdings; review tax impact (LTCG > 1y = 10% over ₹1L)` };
      }
      if (s.bucket === 'shortTerm' && s.action === 'INCREASE') {
        return { ...s, suggestedHow: `Top up paper trading account or short-term debt funds` };
      }
      if (s.bucket === 'shortTerm' && s.action === 'DECREASE') {
        return { ...s, suggestedHow: `Move surplus from short-term debt to long-term equity or emergency` };
      }
      if (s.bucket === 'emergency' && s.action === 'INCREASE') {
        return { ...s, suggestedHow: `Add to liquid funds (HDFC Liquid, ICICI Liquid) for 3-6mo expense cover` };
      }
      if (s.bucket === 'emergency' && s.action === 'DECREASE') {
        return { ...s, suggestedHow: `Move surplus emergency cash to short-term or long-term bucket` };
      }
      return s;
    });

    return {
      ok: true,
      total,
      current,
      target: targets,
      drift,
      thresholdPct: thresh,
      triggered,
      currentINR,
      targetINR: {
        emergency: Math.round(targetINR.emergency),
        shortTerm: Math.round(targetINR.shortTerm),
        longTerm:  Math.round(targetINR.longTerm),
      },
      suggestions: concreteActions,
    };
  }
}

module.exports = { Rebalance };

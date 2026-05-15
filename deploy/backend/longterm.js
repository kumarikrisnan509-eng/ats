// longterm.js -- Stage 5 of the master spec.
//
// Implements the three long-term wealth building blocks:
//   1. SIP manager     -- scheduled equity/MF/ETF investments
//   2. SWP simulator   -- safe withdrawal rate modelling
//   3. Bucket strategy -- emergency / short / long capital allocation
//   4. Goal inflate    -- inflation-adjusted target math
//
// Persists to /var/lib/ats/tokens/_longterm.json.
//
// Public API:
//   const lt = new LongTerm({ audit, storePath })
//   lt.load() / lt.stats()
//   lt.getSips() / lt.setSips(arr)
//   lt.getBuckets() / lt.setBuckets(obj)
//   lt.simulateSwp({ corpus, annualReturnPct, annualInflationPct, monthlyWithdrawalINR, years })
//   lt.inflateGoal({ currentNeedINR, years, annualInflationPct })

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_STORE = '/var/lib/ats/tokens/_longterm.json';

class LongTerm {
  constructor({ audit, storePath } = {}) {
    this.audit = audit || (() => {});
    this.storePath = storePath || DEFAULT_STORE;
    this._sips = [];
    this._buckets = { emergency: 20, shortTerm: 30, longTerm: 50 };
  }

  load() {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      if (Array.isArray(raw.sips))     this._sips = raw.sips;
      if (raw.buckets && typeof raw.buckets === 'object') this._buckets = { ...this._buckets, ...raw.buckets };
      console.log(`[longterm] loaded ${this._sips.length} SIPs, buckets:`, this._buckets);
    } catch (e) { console.warn('[longterm] load failed:', e.message); }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify({
        sips: this._sips,
        buckets: this._buckets,
        updatedAt: new Date().toISOString(),
      }, null, 2));
    } catch (e) { console.error('[longterm] persist failed:', e.message); }
  }

  // -------- SIPs --------
  getSips() { return this._sips.slice(); }

  setSips(sips) {
    if (!Array.isArray(sips)) throw new Error('sips must be an array');
    const valid = sips.slice(0, 50).map(s => ({
      id:          (s.id && String(s.id)) || crypto.randomUUID(),
      enabled:     !!s.enabled,
      name:        String(s.name || 'Unnamed SIP').slice(0, 80),
      symbol:      String(s.symbol || '').slice(0, 40),    // NIFTYBEES / fund code
      targetKind:  ['etf','mf','equity','smallcase'].includes(s.targetKind) ? s.targetKind : 'etf',
      frequency:   ['daily','weekly','monthly','quarterly'].includes(s.frequency) ? s.frequency : 'monthly',
      amountINR:   Math.max(100, Math.floor(Number(s.amountINR) || 0)),
      dayOfMonth:  Math.max(1, Math.min(28, Math.floor(Number(s.dayOfMonth) || 1))),
      goalId:      s.goalId ? String(s.goalId) : null,
      notes:       String(s.notes || '').slice(0, 300),
      createdAt:   s.createdAt || new Date().toISOString(),
    }));
    this._sips = valid;
    this._persist();
    this.audit('longterm.sips.set', { count: valid.length });
    return this.getSips();
  }

  // -------- Buckets --------
  getBuckets() { return { ...this._buckets }; }

  setBuckets(b) {
    if (!b || typeof b !== 'object') throw new Error('buckets must be an object');
    const e = Math.max(0, Math.min(100, Math.floor(Number(b.emergency)  || 0)));
    const s = Math.max(0, Math.min(100, Math.floor(Number(b.shortTerm)  || 0)));
    const l = Math.max(0, Math.min(100, Math.floor(Number(b.longTerm)   || 0)));
    if (e + s + l > 100) throw new Error(`bucket percentages sum to ${e+s+l} (>100)`);
    this._buckets = { emergency: e, shortTerm: s, longTerm: l };
    this._persist();
    this.audit('longterm.buckets.set', this._buckets);
    return this.getBuckets();
  }

  // -------- SWP simulator --------
  /**
   * Systematic Withdrawal Plan modelling. Given a starting corpus and inflation-
   * adjusted monthly withdrawal, projects month-by-month balance over N years.
   * Returns { months:[{ month, balance, withdrawal }], runsOutInYears, isSustainable }.
   */
  simulateSwp({ corpus, annualReturnPct, annualInflationPct, monthlyWithdrawalINR, years }) {
    corpus = Number(corpus) || 0;
    annualReturnPct    = Number(annualReturnPct)    || 0;
    annualInflationPct = Number(annualInflationPct) || 0;
    monthlyWithdrawalINR = Number(monthlyWithdrawalINR) || 0;
    years = Math.max(1, Math.min(50, Math.floor(Number(years) || 25)));
    if (corpus <= 0) throw new Error('corpus must be > 0');
    if (monthlyWithdrawalINR <= 0) throw new Error('monthlyWithdrawalINR must be > 0');

    const r = annualReturnPct / 100 / 12;       // monthly return
    const i = annualInflationPct / 100 / 12;    // monthly inflation
    const totalMonths = years * 12;
    const months = [];
    let balance = corpus;
    let withdrawal = monthlyWithdrawalINR;
    let runsOutMonth = null;

    for (let m = 1; m <= totalMonths; m++) {
      balance = balance * (1 + r) - withdrawal;
      withdrawal = withdrawal * (1 + i);  // inflate next month's draw
      if (balance <= 0 && !runsOutMonth) {
        runsOutMonth = m;
        balance = 0;
      }
      // Record every 12 months to keep payload small
      if (m % 12 === 0 || m === totalMonths || balance === 0) {
        months.push({
          month: m,
          balance: Math.round(balance),
          withdrawal: Math.round(withdrawal),
        });
      }
      if (balance === 0) break;
    }

    return {
      corpus, annualReturnPct, annualInflationPct, monthlyWithdrawalINR, years,
      months,
      runsOutInYears: runsOutMonth ? +(runsOutMonth / 12).toFixed(1) : null,
      isSustainable: runsOutMonth === null,
      endingBalance: Math.round(balance),
    };
  }

  // -------- Goal inflate --------
  /**
   * Given a need today (e.g., child's education costs ₹20L right now), project
   * its future value at the goal year.
   */
  inflateGoal({ currentNeedINR, years, annualInflationPct }) {
    const need = Number(currentNeedINR) || 0;
    const y    = Math.max(0, Math.min(60, Number(years) || 0));
    const inf  = Number(annualInflationPct) || 0;
    if (need <= 0) throw new Error('currentNeedINR must be > 0');
    const future = need * Math.pow(1 + inf / 100, y);
    // Also compute monthly SIP needed (assuming 12% equity returns) to hit that target
    const sipReturnPct = 12;
    const r = sipReturnPct / 100 / 12;
    const n = y * 12;
    // FV = SIP * (((1+r)^n - 1) / r) * (1+r)
    const sip = n > 0 && r > 0 ? future / ((Math.pow(1 + r, n) - 1) / r * (1 + r)) : 0;
    return {
      currentNeedINR: Math.round(need),
      years: y,
      annualInflationPct: inf,
      futureNeedINR: Math.round(future),
      assumedSipReturnPct: sipReturnPct,
      requiredMonthlySIP: Math.round(sip),
    };
  }

  stats() {
    return {
      sipCount: this._sips.length,
      enabledSips: this._sips.filter(s => s.enabled).length,
      totalMonthlyINR: this._sips
        .filter(s => s.enabled && s.frequency === 'monthly')
        .reduce((a, b) => a + (b.amountINR || 0), 0),
      buckets: { ...this._buckets },
    };
  }
}

module.exports = { LongTerm };

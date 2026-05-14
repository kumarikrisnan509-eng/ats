// sweep.js -- profit-sweep rules engine.
//
// Tracks rules like:
//   "When today's realized P&L exceeds INR 2,000, sweep 60% into NIFTYBEES ETF"
//   "Monthly: sweep all profits above INR 50,000 cushion into PPFC SIP"
//
// Persists to /var/lib/ats/tokens/_sweep.json
//
// Public API:
//   const s = new SweepEngine({ getPaperStats, audit, storePath })
//   s.load() / s.stats()
//   s.getRules() / s.setRules(rules[])
//   s.evaluate()            -> what would sweep right now (dry-run)
//   s.execute()             -> log + would-place orders (paper-only initially)
//   s.history(limit)        -> past sweep events

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_STORE = '/var/lib/ats/tokens/_sweep.json';
const HISTORY_MAX = 500;

class SweepEngine {
  /**
   * @param {object} opts
   * @param {Function} opts.getPaperStats   () => paper.stats() snapshot
   * @param {Function} [opts.audit]
   * @param {string}   [opts.storePath]
   */
  constructor({ getPaperStats, audit, storePath } = {}) {
    if (typeof getPaperStats !== 'function') throw new Error('getPaperStats fn required');
    this.getPaperStats = getPaperStats;
    this.audit = audit || (() => {});
    this.storePath = storePath || DEFAULT_STORE;
    this._rules = [];
    this._history = [];
  }

  load() {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      this._rules = Array.isArray(raw.rules) ? raw.rules : [];
      this._history = Array.isArray(raw.history) ? raw.history.slice(-HISTORY_MAX) : [];
      console.log(`[sweep] loaded ${this._rules.length} rules, ${this._history.length} history entries`);
    } catch (e) { console.warn('[sweep] load failed:', e.message); }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify({
        rules: this._rules,
        history: this._history.slice(-HISTORY_MAX),
        updatedAt: new Date().toISOString(),
      }, null, 2));
    } catch (e) { console.error('[sweep] persist failed:', e.message); }
  }

  getRules() { return this._rules.slice(); }

  setRules(rules) {
    if (!Array.isArray(rules)) throw new Error('rules must be an array');
    const valid = rules.slice(0, 20).map(r => ({
      id:           (r.id && String(r.id)) || crypto.randomUUID(),
      enabled:      !!r.enabled,
      cadence:      ['daily','weekly','monthly'].includes(r.cadence) ? r.cadence : 'daily',
      // threshold: only sweep when realized P&L exceeds this
      minProfitINR: Math.max(0, Math.floor(Number(r.minProfitINR) || 0)),
      // sweep amount strategy
      sweepMode:    ['pct','absolute','all_above'].includes(r.sweepMode) ? r.sweepMode : 'pct',
      sweepPct:     Math.max(0, Math.min(100, Number(r.sweepPct) || 0)),
      sweepAbsINR:  Math.max(0, Math.floor(Number(r.sweepAbsINR) || 0)),
      // target: where the swept money goes
      target:       String(r.target || 'NIFTYBEES').slice(0, 40),
      targetKind:   ['etf','sip','smallcase','manual'].includes(r.targetKind) ? r.targetKind : 'etf',
      notes:        String(r.notes || '').slice(0, 300),
    }));
    this._rules = valid;
    this._persist();
    this.audit('sweep.rules.set', { count: valid.length });
    return this.getRules();
  }

  /**
   * Compute what would sweep right now based on current rules + paper stats.
   * Returns { wouldSweep: [{ ruleId, sourceProfit, sweepINR, target }], notes }
   */
  evaluate() {
    const s = this.getPaperStats() || {};
    const realized = s.realizedPnl || 0;
    const out = [];
    const notes = [];
    for (const rule of this._rules) {
      if (!rule.enabled) continue;
      if (realized < rule.minProfitINR) {
        notes.push(`rule ${rule.id.slice(0,8)}: realized ${realized} < threshold ${rule.minProfitINR}`);
        continue;
      }
      const excess = realized - rule.minProfitINR;
      let sweep = 0;
      if (rule.sweepMode === 'pct')         sweep = Math.floor(excess * rule.sweepPct / 100);
      else if (rule.sweepMode === 'absolute') sweep = Math.min(excess, rule.sweepAbsINR);
      else if (rule.sweepMode === 'all_above') sweep = excess;
      if (sweep <= 0) continue;
      out.push({
        ruleId: rule.id,
        cadence: rule.cadence,
        sourceProfit: realized,
        sweepINR: sweep,
        target: rule.target,
        targetKind: rule.targetKind,
        notes: rule.notes,
      });
    }
    return { wouldSweep: out, realizedPnl: realized, notes };
  }

  /**
   * Log a sweep "execution" (paper-only -- doesn't actually place orders yet).
   * In production this would call broker.placeOrder() for the ETF/MF target.
   */
  execute() {
    const ev = this.evaluate();
    const ts = new Date().toISOString();
    const entries = ev.wouldSweep.map(s => ({
      id: crypto.randomUUID(),
      ts,
      ...s,
      status: 'logged', // 'logged' | 'placed' | 'rejected' (when live wiring lands)
    }));
    this._history.push(...entries);
    if (this._history.length > HISTORY_MAX) {
      this._history = this._history.slice(-HISTORY_MAX);
    }
    this._persist();
    this.audit('sweep.execute', { count: entries.length, totalINR: entries.reduce((a,b)=>a+b.sweepINR,0) });
    return { executed: entries, realizedPnl: ev.realizedPnl };
  }

  history(limit) {
    const n = Math.max(1, Math.min(HISTORY_MAX, limit || 50));
    return this._history.slice(-n).reverse();
  }

  stats() {
    const totalSwept = this._history.reduce((s, h) => s + (h.sweepINR || 0), 0);
    const sweptByTarget = {};
    for (const h of this._history) {
      const k = h.target || 'unknown';
      sweptByTarget[k] = (sweptByTarget[k] || 0) + (h.sweepINR || 0);
    }
    return {
      ruleCount:    this._rules.length,
      enabledRules: this._rules.filter(r => r.enabled).length,
      history:      this._history.length,
      totalSweptINR: totalSwept,
      sweptByTarget,
    };
  }
}

module.exports = { SweepEngine };

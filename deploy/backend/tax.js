// tax.js -- tax planning persistence.
//
// Stores:
//   goals[]:        long-term financial goals { id, name, targetINR, deadline, priority }
//   harvestRules:   parameters for tax-loss harvest detection (LTCG threshold etc.)
//   realized[]:     log of harvest decisions taken
//
// Persists to /var/lib/ats/tokens/_tax.json
//
// Public API:
//   const t = new TaxPlanner({ storePath, audit, getClosedTrades })
//   t.load() / t.stats()
//   t.getGoals() / t.setGoals(goals[])
//   t.getHarvestRules() / t.setHarvestRules(rules)
//   t.findHarvestOpportunities()   -> array of trades eligible for harvest
//   t.realizeHarvest(tradeIds[])    -> records the realization decision

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_STORE = '/var/lib/ats/tokens/_tax.json';
const HARVEST_DEFAULTS = {
  // Long-term capital gains threshold in INR per FY (2025-26: ₹1.25 lakh tax-free for equity LTCG)
  ltcgFreeAllowanceINR: 125000,
  // Lookback for short-term losses to bucket against gains
  stcgWindowDays: 365,
  // Min loss size to be worth harvesting (round-trip fees + slippage)
  minLossINR: 500,
};

class TaxPlanner {
  /**
   * @param {object} opts
   * @param {Function} opts.getClosedTrades  () => Array  trade ledger
   * @param {string} [opts.storePath]
   * @param {Function} [opts.audit]
   */
  constructor({ storePath, audit, getClosedTrades } = {}) {
    this.storePath = storePath || DEFAULT_STORE;
    this.audit = audit || (() => {});
    this.getClosedTrades = getClosedTrades || (() => []);
    this._goals = [];
    this._harvestRules = { ...HARVEST_DEFAULTS };
    this._realized = [];
  }

  load() {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      if (raw && typeof raw === 'object') {
        this._goals = Array.isArray(raw.goals) ? raw.goals : [];
        this._harvestRules = { ...HARVEST_DEFAULTS, ...(raw.harvestRules || {}) };
        this._realized = Array.isArray(raw.realized) ? raw.realized : [];
        console.log(`[tax] loaded ${this._goals.length} goals, ${this._realized.length} realizations`);
      }
    } catch (e) { console.warn('[tax] load failed:', e.message); }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify({
        goals: this._goals,
        harvestRules: this._harvestRules,
        realized: this._realized.slice(-1000),
      }, null, 2));
    } catch (e) { console.error('[tax] persist failed:', e.message); }
  }

  getGoals() { return this._goals.slice(); }

  setGoals(goals) {
    if (!Array.isArray(goals)) throw new Error('goals must be an array');
    const clean = goals.slice(0, 50).map(g => ({
      id:        (g.id && String(g.id)) || crypto.randomUUID(),
      name:      String(g.name || '').slice(0, 200),
      targetINR: Math.max(0, Math.floor(Number(g.targetINR) || 0)),
      deadline:  g.deadline ? String(g.deadline).slice(0, 32) : null,
      priority:  Number.isFinite(+g.priority) ? Math.max(0, Math.min(10, +g.priority)) : 5,
      notes:     g.notes ? String(g.notes).slice(0, 500) : '',
    }));
    this._goals = clean;
    this._persist();
    this.audit('tax.goals.set', { count: clean.length });
    return this.getGoals();
  }

  getHarvestRules() { return { ...this._harvestRules }; }

  setHarvestRules(rules) {
    if (!rules || typeof rules !== 'object') throw new Error('rules object required');
    const out = { ...this._harvestRules };
    if (Number.isFinite(+rules.ltcgFreeAllowanceINR)) out.ltcgFreeAllowanceINR = +rules.ltcgFreeAllowanceINR;
    if (Number.isFinite(+rules.stcgWindowDays))        out.stcgWindowDays       = +rules.stcgWindowDays;
    if (Number.isFinite(+rules.minLossINR))            out.minLossINR           = +rules.minLossINR;
    this._harvestRules = out;
    this._persist();
    return this.getHarvestRules();
  }

  /**
   * Find closed trades that are candidates for tax-loss harvest:
   *   1. realizedPnl is sufficiently negative (>= minLossINR loss)
   *   2. Not already realized
   *   3. Within the configured stcgWindowDays
   */
  findHarvestOpportunities() {
    const trades = this.getClosedTrades() || [];
    const rules = this._harvestRules;
    const cutoff = Date.now() - rules.stcgWindowDays * 86400 * 1000;
    const realizedIds = new Set(this._realized.flatMap(r => r.tradeIds || []));
    const out = [];
    for (const t of trades) {
      if (!t.realizedPnl || t.realizedPnl > -rules.minLossINR) continue;
      const closedAt = t.closedAt ? new Date(t.closedAt).getTime() : 0;
      if (closedAt < cutoff) continue;
      const tradeId = t.id || `${t.symbol}|${t.closedAt}|${t.openedAt}`;
      if (realizedIds.has(tradeId)) continue;
      out.push({
        tradeId,
        symbol: t.symbol,
        loss: Math.abs(t.realizedPnl),
        openPrice: t.openPrice,
        closePrice: t.closePrice,
        qty: t.qty,
        closedAt: t.closedAt,
        ageDays: closedAt ? Math.round((Date.now() - closedAt) / 86400 / 1000) : null,
      });
    }
    // Sort by largest loss first
    out.sort((a, b) => b.loss - a.loss);
    return out;
  }

  realizeHarvest(tradeIds, note) {
    if (!Array.isArray(tradeIds) || !tradeIds.length) throw new Error('tradeIds[] required');
    const entry = {
      id: crypto.randomUUID(),
      ts: new Date().toISOString(),
      tradeIds: tradeIds.map(String),
      note: note ? String(note).slice(0, 500) : '',
    };
    this._realized.push(entry);
    this._persist();
    this.audit('tax.realize', { count: tradeIds.length });
    return entry;
  }

  stats() {
    return {
      goalCount:        this._goals.length,
      totalGoalTargetINR: this._goals.reduce((s, g) => s + g.targetINR, 0),
      realizationCount: this._realized.length,
      harvestRules:     this._harvestRules,
    };
  }
}

module.exports = { TaxPlanner };

// pnl-attribution.js -- daily P&L snapshots + per-strategy aggregation.
//
// Once per UTC day we record a row capturing the paper-trading state:
//   { date, cash, totalEquity, realizedPnl, unrealizedPnl, openPositions, closedTrades }
//
// The history file is the source of truth for the equity curve. By-strategy
// aggregation reads the closed-trade ledger from the paper module and groups
// realized P&L by the `strategy` field (if present on the originating order).
//
// Persistence: /var/lib/ats/tokens/_pnl-daily.json
// Capped to the last 730 rows (~2 years).

const fs   = require('fs');
const path = require('path');

const DEFAULT_STORE = '/var/lib/ats/tokens/_pnl-daily.json';
const MAX_ROWS = 730;

class PnlAttribution {
  /**
   * @param {object} opts
   * @param {() => object} opts.getStats   returns paper.stats() snapshot
   * @param {() => Array}  opts.getTrades  returns paper.trades(limit) full array
   * @param {string} [opts.storePath]
   * @param {(event, data) => void} [opts.audit]
   */
  constructor({ getStats, getTrades, storePath, audit } = {}) {
    if (typeof getStats !== 'function')  throw new Error('getStats fn required');
    if (typeof getTrades !== 'function') throw new Error('getTrades fn required');
    this.getStats  = getStats;
    this.getTrades = getTrades;
    this.storePath = storePath || DEFAULT_STORE;
    this.audit     = audit || (() => {});
    this._rows     = [];
    this._timer    = null;
  }

  load() {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      if (raw && Array.isArray(raw.rows)) {
        this._rows = raw.rows.slice(-MAX_ROWS);
        console.log(`[pnl] loaded ${this._rows.length} daily rows`);
      }
    } catch (e) { console.warn('[pnl] load failed:', e.message); }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify({
        rows: this._rows.slice(-MAX_ROWS),
        updatedAt: new Date().toISOString(),
      }, null, 2));
    } catch (e) { console.error('[pnl] persist failed:', e.message); }
  }

  _todayUTC() { return new Date().toISOString().slice(0, 10); }

  /**
   * Take a snapshot for today. If a row for today already exists, overwrite it
   * with the latest values (intra-day updates supported).
   * @returns {object} the row just written
   */
  snapshot() {
    const stats = this.getStats() || {};
    const date  = this._todayUTC();
    const row = {
      date,
      cash:           stats.cash           || 0,
      totalEquity:    stats.totalEquity    || 0,
      realizedPnl:    stats.realizedPnl    || 0,
      unrealizedPnl:  stats.unrealizedPnl  || 0,
      openPositions:  stats.openPositions  || 0,
      closedTrades:   stats.closedTrades   || 0,
      filledOrders:   stats.filledOrders   || 0,
      ts:             new Date().toISOString(),
    };
    const existingIdx = this._rows.findIndex(r => r.date === date);
    if (existingIdx >= 0) this._rows[existingIdx] = row;
    else this._rows.push(row);
    this._rows.sort((a, b) => a.date.localeCompare(b.date));
    this._persist();
    this.audit('pnl.snapshot', { date, totalEquity: row.totalEquity, realizedPnl: row.realizedPnl });
    return row;
  }

  /**
   * Last N daily rows + derived day-over-day equity delta.
   */
  history(days) {
    const n = Math.max(1, Math.min(MAX_ROWS, days || 30));
    const rows = this._rows.slice(-n);
    // Day-over-day delta on totalEquity
    const out = rows.map((r, i) => {
      const prev = i > 0 ? rows[i - 1] : null;
      const delta = prev ? +(r.totalEquity - prev.totalEquity).toFixed(2) : 0;
      return { ...r, dayDelta: delta };
    });
    return out;
  }

  /**
   * Aggregate the closed-trade ledger by `strategy` (defaulting to "manual"
   * for trades whose originating order had no strategy tag).
   */
  byStrategy() {
    const trades = this.getTrades(500) || [];
    const buckets = {};
    for (const t of trades) {
      const k = t.strategy || 'manual';
      const b = buckets[k] || (buckets[k] = {
        strategy: k, trades: 0, wins: 0, losses: 0,
        realizedPnl: 0, bestTrade: -Infinity, worstTrade: Infinity,
      });
      b.trades++;
      if (t.realizedPnl > 0) b.wins++;
      else if (t.realizedPnl < 0) b.losses++;
      b.realizedPnl += t.realizedPnl;
      if (t.realizedPnl > b.bestTrade)  b.bestTrade  = t.realizedPnl;
      if (t.realizedPnl < b.worstTrade) b.worstTrade = t.realizedPnl;
    }
    return Object.values(buckets).map(b => ({
      strategy:    b.strategy,
      trades:      b.trades,
      wins:        b.wins,
      losses:      b.losses,
      winRate:     b.trades ? +(b.wins / b.trades * 100).toFixed(2) : 0,
      realizedPnl: +b.realizedPnl.toFixed(2),
      avgPnl:      b.trades ? +(b.realizedPnl / b.trades).toFixed(2) : 0,
      bestTrade:   b.bestTrade === -Infinity ? 0 : +b.bestTrade.toFixed(2),
      worstTrade:  b.worstTrade === Infinity ? 0 : +b.worstTrade.toFixed(2),
    })).sort((a, b) => b.realizedPnl - a.realizedPnl);
  }

  /**
   * Run snapshot now + schedule a recurring one every 6 hours. The 6h cadence
   * means a daily row gets written at least 4 times -- intra-day overwrites
   * are fine since we key by UTC date.
   */
  start() {
    this.snapshot();
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => {
      try { this.snapshot(); } catch (e) { console.error('[pnl] auto-snapshot err:', e.message); }
    }, 6 * 60 * 60 * 1000);
    this._timer.unref();
  }

  stop() {
    if (this._timer) clearInterval(this._timer);
    this._timer = null;
  }

  stats() {
    const latest = this._rows.length ? this._rows[this._rows.length - 1] : null;
    return {
      rows: this._rows.length,
      latest,
      oldest: this._rows.length ? this._rows[0].date : null,
    };
  }
}

module.exports = { PnlAttribution };

/* eslint-disable */
// bulk-deals.js — E8: NSE daily large-deal snapshot.
//
// Source: https://www.nseindia.com/api/snapshot-capital-market-largedeal
// Returns three buckets: BULK_DEALS (single trade >0.5% of equity), BLOCK_DEALS
// (negotiated, post-market window), SHORT_DEALS (regulatory short-sales report).
// Each row: { date, symbol, name, clientName, buySell, qty, watp, remarks }.
//
// Used for: 'who's buying/selling big in this name' context on signal cards.
// 4-hour cache — NSE refreshes once per day after market close.

'use strict';

const URL_LARGE = 'https://www.nseindia.com/api/snapshot-capital-market-largedeal';
const CACHE_TTL_MS = 4 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
  'Accept': 'application/json',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/',
};

function parseNseDate(d) {
  if (!d) return null;
  const m = String(d).match(/^(\d{1,2})-([A-Za-z]+)-(\d{4})$/);
  if (!m) return null;
  const MO = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
  const mi = MO[m[2].slice(0, 3)];
  if (mi == null) return null;
  return new Date(Date.UTC(parseInt(m[3], 10), mi, parseInt(m[1], 10)));
}

function normalise(row, kind) {
  return {
    kind,
    date_iso: (parseNseDate(row.date) || new Date()).toISOString().slice(0, 10),
    symbol: String(row.symbol || '').toUpperCase().trim(),
    company: row.name || '',
    client: row.clientName || null,
    side: (row.buySell || '').toUpperCase() || null,    // 'BUY' | 'SELL' | null
    qty: parseInt(row.qty, 10) || 0,
    watp: Number(row.watp) || null,                      // weighted avg trade price
    inr_value: ((parseInt(row.qty, 10) || 0) * (Number(row.watp) || 0)) || null,
    remarks: row.remarks || null,
  };
}

class BulkDeals {
  constructor({ fetchImpl } = {}) {
    this.fetchFn = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    this._cache = null;       // { ts, as_on_date, bulk, block, short, by_symbol }
    this._inflight = null;
  }

  async refresh() {
    if (this._inflight) return this._inflight;
    this._inflight = this._doRefresh().finally(() => { this._inflight = null; });
    return this._inflight;
  }

  async _doRefresh() {
    if (!this.fetchFn) throw new Error('no global fetch (need Node 18+)');
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    const t0 = Date.now();
    try {
      const r = await this.fetchFn(URL_LARGE, { headers: HEADERS, signal: ctl.signal });
      if (!r.ok) throw new Error(`largedeal ${r.status}`);
      const raw = await r.json();
      const bulk  = (raw.BULK_DEALS_DATA  || []).map(x => normalise(x, 'bulk')).filter(x => x.symbol);
      const block = (raw.BLOCK_DEALS_DATA || []).map(x => normalise(x, 'block')).filter(x => x.symbol);
      const short = (raw.SHORT_DEALS_DATA || []).map(x => normalise(x, 'short')).filter(x => x.symbol);
      // Sort by INR value desc within each bucket — biggest first
      [bulk, block].forEach(arr => arr.sort((a, b) => (b.inr_value || 0) - (a.inr_value || 0)));
      // Index by symbol for O(1) lookup in /critique-rich
      const bySymbol = new Map();
      for (const d of [...bulk, ...block]) {
        if (!bySymbol.has(d.symbol)) bySymbol.set(d.symbol, []);
        bySymbol.get(d.symbol).push(d);
      }
      this._cache = { ts: Date.now(), fetchedMs: Date.now() - t0,
        as_on_date: raw.as_on_date, bulk, block, short, bySymbol };
      console.log(`[bulk-deals] refreshed in ${this._cache.fetchedMs}ms — bulk=${bulk.length} block=${block.length} short=${short.length}`);
      return this._cache;
    } finally { clearTimeout(to); }
  }

  async _getFresh() {
    const now = Date.now();
    if (this._cache && (now - this._cache.ts) < CACHE_TTL_MS) return this._cache;
    try { await this.refresh(); } catch (e) {
      console.warn('[bulk-deals] refresh failed:', e.message);
      if (!this._cache) this._cache = { ts: now, fetchedMs: 0, as_on_date: null, bulk: [], block: [], short: [], bySymbol: new Map() };
    }
    return this._cache;
  }

  async today({ limit = 50, includeShort = false } = {}) {
    const c = await this._getFresh();
    return {
      as_on_date: c.as_on_date,
      bulk: c.bulk.slice(0, limit),
      block: c.block.slice(0, limit),
      short: includeShort ? c.short.slice(0, limit) : [],
    };
  }

  async forSymbol(symbol) {
    const c = await this._getFresh();
    const sym = String(symbol || '').toUpperCase().trim();
    if (!sym) return [];
    return c.bySymbol.get(sym) || [];
  }

  status() {
    if (!this._cache) return { ready: false };
    return {
      ready: true,
      ageMs: Date.now() - this._cache.ts,
      asOn: this._cache.as_on_date,
      bulk: this._cache.bulk.length,
      block: this._cache.block.length,
      short: this._cache.short.length,
    };
  }
}

module.exports = { BulkDeals };

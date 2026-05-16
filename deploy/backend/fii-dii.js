/* eslint-disable */
// fii-dii.js — E7: daily FII/FPI + DII cash market activity.
//
// Source: https://www.nseindia.com/api/fiidiiTradeReact
// Returns latest trading day's two-row report: one for DII, one for FII/FPI.
// Each row: { category, date, buyValue, sellValue, netValue } in ₹ crores.
//
// Updates once per day (post-market close, around 18:00 IST). Cache 30 min
// to ride through the multiple refreshes during the publication window
// without losing freshness once published.

'use strict';

const URL_FII = 'https://www.nseindia.com/api/fiidiiTradeReact';
const CACHE_TTL_MS = 30 * 60 * 1000;
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

class FiiDii {
  constructor({ fetchImpl } = {}) {
    this.fetchFn = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    this._cache = null;       // { ts, today: {fii, dii}, history: [...] }
    this._inflight = null;
    // 30-day rolling history (cleared on process restart; survives via _cache below)
    this._history = [];
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
      const r = await this.fetchFn(URL_FII, { headers: HEADERS, signal: ctl.signal });
      if (!r.ok) throw new Error(`fiidii ${r.status}`);
      const raw = await r.json();
      if (!Array.isArray(raw)) throw new Error('unexpected shape');
      // Normalize: each row -> {category: 'FII'|'DII', date_iso, buy_cr, sell_cr, net_cr}
      const rows = raw.map(r => ({
        category: /FII|FPI/i.test(r.category) ? 'FII' : 'DII',
        date_iso: (parseNseDate(r.date) || new Date()).toISOString().slice(0, 10),
        buy_cr: Number(r.buyValue) || 0,
        sell_cr: Number(r.sellValue) || 0,
        net_cr: Number(r.netValue) || 0,
        raw_date: r.date,
      }));
      const today = {
        date_iso: rows[0]?.date_iso || null,
        fii: rows.find(x => x.category === 'FII') || null,
        dii: rows.find(x => x.category === 'DII') || null,
        net_total_cr: rows.reduce((s, x) => s + x.net_cr, 0),
      };

      // Append to rolling history if it's a new trading day; keep last 30 sessions
      const todayKey = today.date_iso;
      if (todayKey && (!this._history.length || this._history[0].date_iso !== todayKey)) {
        this._history.unshift({
          date_iso: todayKey,
          fii_net_cr: (today.fii && today.fii.net_cr) || 0,
          dii_net_cr: (today.dii && today.dii.net_cr) || 0,
        });
        if (this._history.length > 30) this._history.length = 30;
      }

      this._cache = { ts: Date.now(), fetchedMs: Date.now() - t0, today, history: this._history.slice() };
      console.log(`[fii-dii] refreshed in ${this._cache.fetchedMs}ms — ${today.date_iso}: FII net ${today.fii ? today.fii.net_cr : '?'} Cr, DII net ${today.dii ? today.dii.net_cr : '?'} Cr`);
      return this._cache;
    } finally { clearTimeout(to); }
  }

  async _getFresh() {
    const now = Date.now();
    if (this._cache && (now - this._cache.ts) < CACHE_TTL_MS) return this._cache;
    try { await this.refresh(); } catch (e) {
      console.warn('[fii-dii] refresh failed:', e.message);
      if (!this._cache) this._cache = { ts: now, fetchedMs: 0, today: null, history: [] };
    }
    return this._cache;
  }

  async today() { return (await this._getFresh()).today; }

  async snapshot() {
    const c = await this._getFresh();
    return {
      today: c.today,
      history: c.history,
      ts: new Date(c.ts).toISOString(),
    };
  }

  status() {
    if (!this._cache) return { ready: false };
    return {
      ready: true,
      ageMs: Date.now() - this._cache.ts,
      lastDate: this._cache.today?.date_iso || null,
      historyDays: this._cache.history?.length || 0,
    };
  }
}

module.exports = { FiiDii };

/* eslint-disable */
// earnings-calendar.js — E4: NSE corporate event calendar.
//
// Source: https://www.nseindia.com/api/event-calendar
// Returns ~500 upcoming events (mostly quarterly Financial Results + dividends).
// Verified live: 153KB JSON, list of { symbol, company, purpose, bm_desc, date }.
//
// nseindia.com/api needs browser-ish headers (UA + Accept + Referer) — the
// archives.nseindia.com paths are Cloudflare-blocked for this resource so we
// can't use them. The headers below pass; failure mode is graceful (return
// last good cache, or empty list).
//
// Cache TTL: 6 hours. NSE refreshes through the day as companies file
// announcements, but the per-event cadence is once-per-day at most.

'use strict';

const URL_EVENT_CAL = 'https://www.nseindia.com/api/event-calendar';
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 15_000;

// Browser-ish headers required by nseindia /api/*
const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0 Safari/537.36',
  'Accept': 'application/json,text/plain,*/*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer': 'https://www.nseindia.com/',
};

function parseNseDate(d) {
  // Format: '18-May-2026'
  if (!d || typeof d !== 'string') return null;
  const m = d.match(/^(\d{1,2})-([A-Za-z]+)-(\d{4})$/);
  if (!m) return null;
  const MONTHS = { Jan:0, Feb:1, Mar:2, Apr:3, May:4, Jun:5, Jul:6, Aug:7, Sep:8, Oct:9, Nov:10, Dec:11 };
  const mi = MONTHS[m[2].slice(0, 3)];
  if (mi == null) return null;
  return new Date(Date.UTC(parseInt(m[3], 10), mi, parseInt(m[1], 10)));
}

function categorise(purpose) {
  const p = (purpose || '').toLowerCase();
  if (p.includes('financial result')) return 'results';
  if (p.includes('dividend')) return 'dividend';
  if (p.includes('bonus')) return 'bonus';
  if (p.includes('split')) return 'split';
  if (p.includes('rights')) return 'rights';
  if (p.includes('buy')) return 'buyback';
  if (p.includes('agm')) return 'agm';
  if (p.includes('egm')) return 'egm';
  if (p.includes('fund rais') || p.includes('fund-rais')) return 'fund_raising';
  return 'other';
}

class EarningsCalendar {
  constructor({ fetchImpl } = {}) {
    this.fetchFn = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    this._cache = null;       // { ts, events: [...] }
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
      const r = await this.fetchFn(URL_EVENT_CAL, { headers: HEADERS, signal: ctl.signal });
      if (!r.ok) throw new Error(`event-calendar ${r.status}`);
      const raw = await r.json();
      if (!Array.isArray(raw)) throw new Error('unexpected shape');
      const events = raw.map(e => ({
        symbol: String(e.symbol || '').toUpperCase().trim(),
        company: String(e.company || '').trim(),
        date: e.date,
        date_iso: (parseNseDate(e.date) || new Date()).toISOString().slice(0, 10),
        purpose: e.purpose || '',
        category: categorise(e.purpose),
        bm_desc: e.bm_desc || '',
      })).filter(e => e.symbol);
      this._cache = { ts: Date.now(), fetchedMs: Date.now() - t0, events };
      console.log(`[earnings-cal] refreshed in ${this._cache.fetchedMs}ms — ${events.length} events`);
      return this._cache;
    } finally { clearTimeout(to); }
  }

  async _getFresh() {
    const now = Date.now();
    if (this._cache && (now - this._cache.ts) < CACHE_TTL_MS) return this._cache;
    try { await this.refresh(); } catch (e) {
      console.warn('[earnings-cal] refresh failed:', e.message);
      if (!this._cache) this._cache = { ts: now, fetchedMs: 0, events: [] };
    }
    return this._cache;
  }

  /** Upcoming events in the next N days, optionally filtered by category. */
  async upcoming({ days = 30, category = null } = {}) {
    const cache = await this._getFresh();
    const cutoff = Date.now() + days * 86400_000;
    const today = Date.now() - 86400_000;   // include today
    const out = [];
    for (const e of cache.events) {
      const t = parseNseDate(e.date);
      if (!t) continue;
      const ms = t.getTime();
      if (ms < today || ms > cutoff) continue;
      if (category && e.category !== category) continue;
      out.push(e);
    }
    out.sort((a, b) => (parseNseDate(a.date)?.getTime() || 0) - (parseNseDate(b.date)?.getTime() || 0));
    return out;
  }

  /** Events for a specific symbol in the next N days. Empty array if none. */
  async forSymbol(symbol, { days = 60 } = {}) {
    const cache = await this._getFresh();
    const sym = String(symbol || '').toUpperCase().trim();
    if (!sym) return [];
    const cutoff = Date.now() + days * 86400_000;
    const today = Date.now() - 86400_000;
    const out = [];
    for (const e of cache.events) {
      if (e.symbol !== sym) continue;
      const t = parseNseDate(e.date);
      if (!t) continue;
      const ms = t.getTime();
      if (ms < today || ms > cutoff) continue;
      out.push({ ...e, days_until: Math.round((ms - Date.now()) / 86400_000) });
    }
    out.sort((a, b) => a.days_until - b.days_until);
    return out;
  }

  status() {
    if (!this._cache) return { ready: false };
    return {
      ready: true,
      ageMs: Date.now() - this._cache.ts,
      eventCount: this._cache.events.length,
      lastFetchMs: this._cache.fetchedMs,
    };
  }
}

module.exports = { EarningsCalendar, parseNseDate, categorise };

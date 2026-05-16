/* eslint-disable */
// mf-data.js — G8: mutual-fund data foundation.
//
// Two sources, both verified working without auth:
//   1. AMFI scheme master  https://portal.amfiindia.com/spages/NAVAll.txt
//      ~17,000 schemes + today's NAV. Semicolon-separated text. Refresh daily.
//   2. MFAPI per-scheme NAV history  https://api.mfapi.in/mf/<schemeCode>
//      Returns scheme metadata + full NAV history (often 500-3000 daily NAVs).
//      No rate limit advertised but treat respectfully (1 request per scheme,
//      cache per-scheme histories for 6h).
//
// Opens the door for the mf_pick AI workflow + an MF screener page later.

'use strict';

const URL_AMFI = 'https://portal.amfiindia.com/spages/NAVAll.txt';
const URL_MFAPI = 'https://api.mfapi.in/mf/';
const CACHE_MASTER_MS = 12 * 60 * 60 * 1000;     // 12h — scheme list barely changes
const CACHE_NAV_MS = 6 * 60 * 60 * 1000;          // 6h per-scheme
const FETCH_TIMEOUT_MS = 20_000;
const UA = 'Mozilla/5.0 (compatible; ATSBot/1.0; +https://ats.rajasekarselvam.com)';

class MfData {
  constructor({ fetchImpl } = {}) {
    this.fetchFn = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    this._master = null;        // { ts, schemes: [...], byCode: Map, byName: Map }
    this._navCache = new Map(); // schemeCode -> { ts, payload }
    this._inflight = null;
  }

  async refreshMaster() {
    if (this._inflight) return this._inflight;
    this._inflight = this._doRefreshMaster().finally(() => { this._inflight = null; });
    return this._inflight;
  }

  async _doRefreshMaster() {
    if (!this.fetchFn) throw new Error('no global fetch');
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    const t0 = Date.now();
    try {
      const r = await this.fetchFn(URL_AMFI, { headers: { 'User-Agent': UA }, signal: ctl.signal, redirect: 'follow' });
      if (!r.ok) throw new Error(`amfi ${r.status}`);
      const txt = await r.text();
      const schemes = this._parseAmfi(txt);
      const byCode = new Map();
      for (const s of schemes) byCode.set(s.code, s);
      this._master = { ts: Date.now(), fetchedMs: Date.now() - t0, schemes, byCode };
      console.log(`[mf-data] master refreshed in ${this._master.fetchedMs}ms — ${schemes.length} schemes`);
      return this._master;
    } finally { clearTimeout(to); }
  }

  _parseAmfi(txt) {
    const out = [];
    let amc = null;
    let category = null;
    for (const line of txt.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      if (trimmed.startsWith('Scheme Code')) continue;
      if (trimmed.startsWith('Open Ended Schemes(') || trimmed.startsWith('Close Ended Schemes(') || trimmed.startsWith('Interval Fund Schemes(')) {
        category = trimmed; amc = null; continue;
      }
      if (!trimmed.includes(';')) { amc = trimmed; continue; }
      const parts = trimmed.split(';');
      if (parts.length < 6) continue;
      const code = parseInt(parts[0], 10);
      if (!Number.isFinite(code)) continue;
      out.push({
        code,
        isin_growth: (parts[1] || '').trim(),
        isin_div: (parts[2] || '').trim(),
        name: (parts[3] || '').trim(),
        nav: Number(parts[4]) || null,
        date: (parts[5] || '').trim(),
        amc,
        category,
      });
    }
    return out;
  }

  async _getMaster() {
    const now = Date.now();
    if (this._master && (now - this._master.ts) < CACHE_MASTER_MS) return this._master;
    try { await this.refreshMaster(); } catch (e) {
      console.warn('[mf-data] master refresh failed:', e.message);
      if (!this._master) this._master = { ts: now, schemes: [], byCode: new Map() };
    }
    return this._master;
  }

  /** Substring search across scheme name + AMC. Case-insensitive. Returns top N. */
  async search(query, { limit = 20 } = {}) {
    const m = await this._getMaster();
    const q = String(query || '').toLowerCase().trim();
    if (!q) return [];
    const out = [];
    for (const s of m.schemes) {
      const hayName = (s.name || '').toLowerCase();
      const hayAmc = (s.amc || '').toLowerCase();
      if (hayName.includes(q) || hayAmc.includes(q)) {
        out.push(s);
        if (out.length >= limit * 3) break;     // collect 3x then re-rank
      }
    }
    // Rank: exact-name-prefix > name-includes > amc-includes
    out.sort((a, b) => {
      const an = a.name.toLowerCase(), bn = b.name.toLowerCase();
      const ap = an.startsWith(q) ? 0 : an.includes(q) ? 1 : 2;
      const bp = bn.startsWith(q) ? 0 : bn.includes(q) ? 1 : 2;
      if (ap !== bp) return ap - bp;
      return an.length - bn.length;   // prefer shorter (less qualified) names
    });
    return out.slice(0, limit);
  }

  /** NAV history for a scheme. Cached 6h. */
  async navHistory(schemeCode) {
    const code = parseInt(schemeCode, 10);
    if (!Number.isFinite(code)) throw new Error('bad scheme code');
    const cached = this._navCache.get(code);
    const now = Date.now();
    if (cached && (now - cached.ts) < CACHE_NAV_MS) return cached.payload;
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await this.fetchFn(URL_MFAPI + code, { headers: { 'User-Agent': UA, 'Accept': 'application/json' }, signal: ctl.signal });
      if (!r.ok) throw new Error(`mfapi ${r.status}`);
      const j = await r.json();
      if (j.status !== 'SUCCESS') throw new Error('mfapi status: ' + j.status);
      const payload = {
        code,
        scheme_name: j.meta?.scheme_name,
        scheme_category: j.meta?.scheme_category,
        fund_house: j.meta?.fund_house,
        scheme_type: j.meta?.scheme_type,
        // data: [{date: '15-05-2026', nav: '104.5968'}, ...] most-recent-first
        navs: (j.data || []).map(d => ({ date: d.date, nav: Number(d.nav) })).filter(d => Number.isFinite(d.nav)),
      };
      this._navCache.set(code, { ts: now, payload });
      // Prevent unbounded growth
      if (this._navCache.size > 200) this._navCache.delete(this._navCache.keys().next().value);
      return payload;
    } finally { clearTimeout(to); }
  }

  status() {
    if (!this._master) return { ready: false };
    return {
      ready: true,
      ageMs: Date.now() - this._master.ts,
      schemeCount: this._master.schemes.length,
      navCacheSize: this._navCache.size,
    };
  }
}

module.exports = { MfData };

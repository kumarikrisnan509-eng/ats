/* eslint-disable */
// nse-surveillance.js — T99-E2 surveillance gate (URL fix in T99 Day 2).
//
// Fetches NSE's daily securities master list. Single endpoint
//   https://archives.nseindia.com/content/equities/sec_list.csv
// covers everything we need:
//   - Series (col 2): BE/BZ/BL/ST/IV/SZ = restricted (T2T behavior)
//   - Remarks (col 5): "GSM STAGE - 0/I/II/III/IV" = Graded Surveillance
//
// ASM (Additional Surveillance Measure) lives in a separate NSE PDF -- not
// parsed today. The scanner is still safe: T2T + GSM gates remove most of
// the dangerous names already.
//
// Cache TTL: 1 hour. NSE refreshes overnight (~19:00 IST).

'use strict';

const URL_SEC_LIST = 'https://archives.nseindia.com/content/equities/sec_list.csv';
const CACHE_TTL_MS = 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12_000;
const UA = 'Mozilla/5.0 (compatible; ATSBot/1.0; +https://ats.rajasekarselvam.com)';

const T2T_SERIES = new Set(['BE', 'BZ', 'BL', 'ST', 'IV', 'SZ']);
const ROMAN = { '0': 0, 'I': 1, 'II': 2, 'III': 3, 'IV': 4, 'V': 5 };

class NseSurveillance {
  constructor({ fetchImpl } = {}) {
    this.fetchFn = fetchImpl || (typeof fetch !== 'undefined' ? fetch : null);
    this._cache = null;
    this._inflight = null;
  }

  async refresh() {
    if (this._inflight) return this._inflight;
    this._inflight = this._doRefresh().finally(() => { this._inflight = null; });
    return this._inflight;
  }

  async _doRefresh() {
    if (!this.fetchFn) throw new Error('no global fetch (need Node 18+)');
    const t0 = Date.now();
    const csv = await this._fetchCsv(URL_SEC_LIST).catch(e => {
      console.warn('[surveillance] sec_list fetch failed:', e.message);
      return null;
    });
    const parsed = this._parseSecList(csv);
    this._cache = {
      ts: Date.now(),
      fetchedMs: Date.now() - t0,
      ...parsed,
      counts: { gsm: parsed.gsm.size, t2t: parsed.t2t.size, asm: parsed.asm.size },
    };
    console.log(`[surveillance] refreshed in ${this._cache.fetchedMs}ms — GSM=${parsed.gsm.size} T2T=${parsed.t2t.size} ASM=${parsed.asm.size}`);
    return this._cache;
  }

  async _fetchCsv(url) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await this.fetchFn(url, { headers: { 'User-Agent': UA, 'Accept': 'text/csv,*/*' }, signal: ctl.signal });
      if (!r.ok) throw new Error(`${url} -> ${r.status}`);
      return await r.text();
    } finally { clearTimeout(to); }
  }

  _parseSecList(csv) {
    const t2t = new Set();
    const gsm = new Map();
    const asm = new Map();
    if (!csv) return { t2t, gsm, asm };

    const lines = csv.split(/\r?\n/).filter(Boolean);
    lines.shift();
    for (const line of lines) {
      const parts = this._splitCsv(line);
      const sym = (parts[0] || '').trim().toUpperCase();
      if (!sym) continue;
      const series = (parts[1] || '').trim().toUpperCase();
      const remarks = (parts[4] || '').trim();

      if (T2T_SERIES.has(series)) t2t.add(sym);

      const gsmMatch = remarks.match(/GSM\s*STAGE\s*-?\s*(IV|III|II|I|0|\d+)/i);
      if (gsmMatch) {
        const raw = gsmMatch[1].toUpperCase();
        const stage = ROMAN[raw] != null ? ROMAN[raw] : parseInt(raw, 10);
        if (!Number.isNaN(stage)) gsm.set(sym, { stage, raw: remarks });
      }
      const asmMatch = remarks.match(/ASM\s*STAGE\s*-?\s*(IV|III|II|I|0|\d+)/i);
      if (asmMatch) {
        const raw = asmMatch[1].toUpperCase();
        const stage = ROMAN[raw] != null ? ROMAN[raw] : parseInt(raw, 10);
        if (!Number.isNaN(stage)) asm.set(sym, { stage, raw: remarks });
      }
    }
    return { t2t, gsm, asm };
  }

  _splitCsv(line) {
    const out = []; let cur = ''; let inQ = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') { inQ = !inQ; continue; }
      if (c === ',' && !inQ) { out.push(cur); cur = ''; continue; }
      cur += c;
    }
    out.push(cur);
    return out;
  }

  async _getFresh() {
    const now = Date.now();
    if (this._cache && (now - this._cache.ts) < CACHE_TTL_MS) return this._cache;
    try { await this.refresh(); } catch (e) {
      console.warn('[surveillance] refresh failed:', e.message);
      if (!this._cache) this._cache = { ts: now, fetchedMs: 0, t2t: new Set(), gsm: new Map(), asm: new Map(), counts: { gsm: 0, t2t: 0, asm: 0 } };
    }
    return this._cache;
  }

  async classify(symbol, { strict = false } = {}) {
    const sym = String(symbol || '').toUpperCase().trim();
    if (!sym) return null;
    const cache = await this._getFresh();
    return this._classifyAgainst(cache, sym, strict);
  }

  classifySync(symbol, { strict = false } = {}) {
    if (!this._cache) return null;
    const sym = String(symbol || '').toUpperCase().trim();
    if (!sym) return null;
    return this._classifyAgainst(this._cache, sym, strict);
  }

  _classifyAgainst(cache, sym, strict) {
    const minGsm = strict ? 0 : 2;
    const minAsm = strict ? 1 : 3;
    if (cache.t2t.has(sym)) return { reason: 't2t', list: 'T2T', stage: null };
    const gsm = cache.gsm.get(sym);
    if (gsm && gsm.stage != null && gsm.stage >= minGsm) return { reason: 'gsm_stage_' + gsm.stage, list: 'GSM', stage: gsm.stage };
    const asm = cache.asm.get(sym);
    if (asm && asm.stage != null && asm.stage >= minAsm) return { reason: 'asm_stage_' + asm.stage, list: 'ASM', stage: asm.stage };
    return null;
  }

  status() {
    if (!this._cache) return { ready: false };
    return {
      ready: true,
      ageMs: Date.now() - this._cache.ts,
      counts: this._cache.counts,
      lastFetchMs: this._cache.fetchedMs,
    };
  }
}

module.exports = { NseSurveillance };

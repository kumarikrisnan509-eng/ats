/* eslint-disable */
// nse-surveillance.js — T99-E2 surveillance gate.
//
// Fetches NSE's daily surveillance lists (ASM / GSM / T-to-T) so the momentum
// scanner can skip any symbol that's under restriction. SEBI + NSE put stocks
// on these lists when there's circular-trading suspicion, price manipulation,
// or low-float pump-and-dump risk. Trading them is allowed but the AI critic
// + the live trader should NEVER auto-route into these names.
//
// Sources (verified working in T99-research, no auth required):
//   ASM list: https://archives.nseindia.com/content/equities/asm_stage1_2_3.csv
//   GSM list: https://archives.nseindia.com/content/equities/gsm_list.csv
//   T2T list: https://archives.nseindia.com/content/equities/sec_list_t2t.csv
//
// The /api endpoint (www.nseindia.com/api/*) is Cloudflare-blocked, but the
// archives.nseindia.com subdomain serves raw CSV with no headers needed.
//
// Cache TTL: 1 hour. NSE updates these lists end-of-day around 19:00 IST.

'use strict';

const URL_ASM_STAGES = 'https://archives.nseindia.com/content/equities/asm_stage1_2_3.csv';
const URL_GSM        = 'https://archives.nseindia.com/content/equities/gsm_list.csv';
const URL_T2T        = 'https://archives.nseindia.com/content/equities/sec_list_t2t.csv';

const CACHE_TTL_MS = 60 * 60 * 1000;       // 1 hour
const FETCH_TIMEOUT_MS = 12_000;
const UA = 'Mozilla/5.0 (compatible; ATSBot/1.0; +https://ats.rajasekarselvam.com)';

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
    const [asmCsv, gsmCsv, t2tCsv] = await Promise.all([
      this._fetchCsv(URL_ASM_STAGES).catch(e => { console.warn('[surveillance] ASM fetch failed:', e.message); return null; }),
      this._fetchCsv(URL_GSM).catch(e => { console.warn('[surveillance] GSM fetch failed:', e.message); return null; }),
      this._fetchCsv(URL_T2T).catch(e => { console.warn('[surveillance] T2T fetch failed:', e.message); return null; }),
    ]);

    const asm = this._parseStageList(asmCsv);
    const gsm = this._parseStageList(gsmCsv);
    const t2t = this._parseSymbolSet(t2tCsv);

    this._cache = {
      ts: Date.now(),
      fetchedMs: Date.now() - t0,
      asm, gsm, t2t,
      counts: { asm: asm.size, gsm: gsm.size, t2t: t2t.size },
    };
    console.log(`[surveillance] refreshed in ${this._cache.fetchedMs}ms — ASM=${asm.size} GSM=${gsm.size} T2T=${t2t.size}`);
    return this._cache;
  }

  async _fetchCsv(url) {
    const ctl = new AbortController();
    const to = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    try {
      const r = await this.fetchFn(url, { headers: { 'User-Agent': UA, 'Accept': 'text/csv,*/*' }, signal: ctl.signal });
      if (!r.ok) throw new Error(`${url} -> ${r.status}`);
      return await r.text();
    } finally {
      clearTimeout(to);
    }
  }

  _parseStageList(csv) {
    const out = new Map();
    if (!csv) return out;
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const header = (lines.shift() || '').toLowerCase();
    const cols = header.split(',');
    const symIdx = cols.findIndex(c => /symbol/i.test(c));
    const stageIdx = cols.findIndex(c => /(asm|gsm|stage)/i.test(c));
    for (const line of lines) {
      const parts = this._splitCsv(line);
      const sym = (parts[symIdx >= 0 ? symIdx : 0] || '').trim().toUpperCase();
      if (!sym) continue;
      const stageRaw = (parts[stageIdx >= 0 ? stageIdx : 1] || '').trim();
      const m = stageRaw.match(/(?:stage|st|s)?\s*(\d+)/i);
      const stage = m ? parseInt(m[1], 10) : null;
      out.set(sym, { stage, raw: stageRaw });
    }
    return out;
  }

  _parseSymbolSet(csv) {
    const out = new Set();
    if (!csv) return out;
    const lines = csv.split(/\r?\n/).filter(Boolean);
    const header = (lines.shift() || '').toLowerCase();
    const cols = header.split(',');
    const symIdx = cols.findIndex(c => /symbol/i.test(c));
    for (const line of lines) {
      const parts = this._splitCsv(line);
      const sym = (parts[symIdx >= 0 ? symIdx : 0] || '').trim().toUpperCase();
      if (sym) out.add(sym);
    }
    return out;
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
      if (!this._cache) this._cache = { ts: now, fetchedMs: 0, asm: new Map(), gsm: new Map(), t2t: new Set(), counts: { asm: 0, gsm: 0, t2t: 0 } };
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
    const minAsm = strict ? 1 : 3;
    const minGsm = strict ? 1 : 2;
    const asm = cache.asm.get(sym);
    if (asm && asm.stage != null && asm.stage >= minAsm) return { reason: 'asm_stage_' + asm.stage, list: 'ASM', stage: asm.stage };
    const gsm = cache.gsm.get(sym);
    if (gsm && gsm.stage != null && gsm.stage >= minGsm) return { reason: 'gsm_stage_' + gsm.stage, list: 'GSM', stage: gsm.stage };
    if (cache.t2t.has(sym)) return { reason: 't2t', list: 'T2T', stage: null };
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

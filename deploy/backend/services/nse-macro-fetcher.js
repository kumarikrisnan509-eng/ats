// T-280c -- NSE macro indicator fetcher (Phase 5, supports T-280b).
//
// Pulls three macro signals from NSE public endpoints:
//   - FII/DII net flow (INR crore, signed)
//   - NIFTY 500 advancers/decliners ratio
//   - 52-week highs vs lows count ratio
//
// NSE's "public" endpoints expect a real browser session (User-Agent +
// cookie warm-up via the homepage). They rate-limit aggressively and
// occasionally return 403/429 when something looks bot-like. This module
// degrades gracefully: any non-2xx returns null for that signal. The
// regime-detector's T-280b extension is backward-compatible with null
// inputs, so a complete NSE failure just falls back to v1 classifier.
//
// Caches to the new option_quotes-style table macro_signals so a daily
// cron can populate once per day and the engine reads from DB.
//
// Public API:
//   const f = createNseMacroFetcher({ db, log });
//   await f.fetchAll();                      -> {fiiNetFlow, marketBreadth, highLowRatio, errors}
//   f.cachedLatest();                         -> last persisted row from DB
//   f.start({intervalMs});                    -> daily auto-refresh
//   f.stop();
//
// Env gate: NSE_MACRO_FETCH_ENABLED=true to enable cron auto-start. The
// fetchAll() method works without the gate (one-shot manual refresh).

'use strict';

const NSE_HEADERS = {
  'User-Agent':      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept':          'application/json, text/plain, */*',
  'Accept-Language': 'en-US,en;q=0.9',
  'Referer':         'https://www.nseindia.com/',
  'Connection':      'keep-alive',
};

const FII_DII_URL    = 'https://www.nseindia.com/api/fiidiiTradeReact';
const BREADTH_URL    = 'https://www.nseindia.com/api/equity-stockIndices?index=NIFTY%20500';
const HIGHS_LOWS_URL = 'https://www.nseindia.com/api/live-analysis-data-52Week';
const WARMUP_URL     = 'https://www.nseindia.com/';

const DEFAULT_INTERVAL_MS = 24 * 60 * 60 * 1000;  // once a day
const TIMEOUT_MS = 8000;

class NseMacroFetcher {
  constructor({ db, log, now } = {}) {
    if (!db) throw new Error('db required');
    this.db = db;
    this.conn = db._conn;
    this.log = log || ((msg) => console.log('[nse-macro]', msg));
    this.now = typeof now === 'function' ? now : (() => new Date());
    this._cookieJar = '';
    this._timer = null;

    // Ensure the macro_signals table exists (idempotent migration since the
    // schema file gets updated only when caller chooses to add it).
    this.conn.exec(`
      CREATE TABLE IF NOT EXISTS macro_signals (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        fetched_at      TEXT    NOT NULL DEFAULT (datetime('now')),
        fii_net_flow    REAL,
        market_breadth  REAL,
        high_low_ratio  REAL,
        source          TEXT,
        errors_json     TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_macro_signals_fetched_at ON macro_signals(fetched_at DESC);
    `);

    this._insert = this.conn.prepare(`
      INSERT INTO macro_signals (fii_net_flow, market_breadth, high_low_ratio, source, errors_json)
      VALUES (@fii_net_flow, @market_breadth, @high_low_ratio, @source, @errors_json)
    `);
    this._latest = this.conn.prepare(`
      SELECT id, fetched_at AS fetchedAt, fii_net_flow AS fiiNetFlow,
             market_breadth AS marketBreadth, high_low_ratio AS highLowRatio,
             source, errors_json AS errorsJson
      FROM macro_signals ORDER BY id DESC LIMIT 1
    `);
  }

  static isEnabled() {
    const v = process.env.NSE_MACRO_FETCH_ENABLED;
    return v === 'true' || v === '1' || v === 'yes';
  }

  async _warmUp() {
    // NSE issues session cookies on the homepage. Without them, JSON endpoints
    // return 403. Best-effort.
    try {
      const r = await this._raw(WARMUP_URL);
      if (r && r.headers && r.headers.get) {
        const setCookie = r.headers.get('set-cookie');
        if (setCookie) this._cookieJar = setCookie.split(';')[0];
      }
    } catch (_) { /* swallow */ }
  }

  async _raw(url) {
    const ac = new AbortController();
    const to = setTimeout(() => ac.abort(), TIMEOUT_MS);
    try {
      const headers = { ...NSE_HEADERS };
      if (this._cookieJar) headers.Cookie = this._cookieJar;
      return await fetch(url, { headers, signal: ac.signal });
    } finally { clearTimeout(to); }
  }

  async _getJson(url) {
    const r = await this._raw(url);
    if (!r || !r.ok) {
      const status = r ? r.status : 0;
      throw new Error(`http ${status}`);
    }
    return await r.json();
  }

  async _fetchFiiDii() {
    const data = await this._getJson(FII_DII_URL);
    // Shape (varies): [{category:'FII/FPI', date, buyValue, sellValue, netValue}, {category:'DII', ...}]
    // We sum FII netValue (FII/FPI is the equity flow that moves index regime).
    if (!Array.isArray(data)) throw new Error('fii_dii: unexpected shape');
    const fii = data.find(d => /fii|fpi/i.test(d.category || '')) || data[0];
    const net = Number(fii && (fii.netValue ?? fii.net));
    return Number.isFinite(net) ? net : null;
  }

  async _fetchBreadth() {
    const data = await this._getJson(BREADTH_URL);
    // Shape: { advance: { advances, declines, unchanged }, data: [...] }
    let adv = null, dec = null;
    if (data && data.advance) {
      adv = Number(data.advance.advances);
      dec = Number(data.advance.declines);
    } else if (data && Array.isArray(data.data)) {
      // Fallback: count rows with change > 0 vs < 0
      adv = data.data.filter(r => Number(r.change) > 0).length;
      dec = data.data.filter(r => Number(r.change) < 0).length;
    }
    if (!Number.isFinite(adv) || !Number.isFinite(dec) || dec === 0) return null;
    return adv / dec;
  }

  async _fetch52w() {
    const data = await this._getJson(HIGHS_LOWS_URL);
    // Shape: { high: {data: [...]} , low: {data: [...]} }
    const highs = data && data.high && Array.isArray(data.high.data) ? data.high.data.length : null;
    const lows  = data && data.low  && Array.isArray(data.low.data)  ? data.low.data.length  : null;
    if (!Number.isFinite(highs) || !Number.isFinite(lows) || lows === 0) return null;
    return highs / lows;
  }

  async fetchAll() {
    const errors = [];
    await this._warmUp();
    let fiiNetFlow = null, marketBreadth = null, highLowRatio = null;

    try { fiiNetFlow    = await this._fetchFiiDii(); }
    catch (e) { errors.push(`fii_dii: ${e.message}`); }
    try { marketBreadth = await this._fetchBreadth(); }
    catch (e) { errors.push(`breadth: ${e.message}`); }
    try { highLowRatio  = await this._fetch52w(); }
    catch (e) { errors.push(`52w: ${e.message}`); }

    this._insert.run({
      fii_net_flow:   fiiNetFlow,
      market_breadth: marketBreadth,
      high_low_ratio: highLowRatio,
      source: 'nse_public',
      errors_json: errors.length ? JSON.stringify(errors) : null,
    });
    this.log(`fetchAll: fii=${fiiNetFlow}, breadth=${marketBreadth}, hl=${highLowRatio}, errors=${errors.length}`);
    return { fiiNetFlow, marketBreadth, highLowRatio, errors };
  }

  cachedLatest() {
    return this._latest.get() || null;
  }

  start({ intervalMs } = {}) {
    if (!NseMacroFetcher.isEnabled()) {
      this.log('start refused: NSE_MACRO_FETCH_ENABLED is not true');
      return false;
    }
    if (this._timer) { this.log('already running'); return false; }
    const period = Number.isFinite(intervalMs) && intervalMs > 60000 ? intervalMs : DEFAULT_INTERVAL_MS;
    this._timer = setInterval(() => this.fetchAll().catch(e => this.log(`tick failed: ${e.message}`)), period);
    this.log(`started: @ ${period}ms`);
    this.fetchAll().catch(e => this.log(`initial fetch failed: ${e.message}`));
    return true;
  }

  stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; this.log('stopped'); } }
}

// ---- Smoke tests ----

const SMOKE = () => {
  const Database = require('better-sqlite3');
  const fs = require('fs');
  const path = require('path');
  const db = new Database(':memory:');
  db.exec(fs.readFileSync(path.join(__dirname, '..', 'schema.sql'), 'utf-8'));
  const wrapper = { _conn: db, exec: (s) => db.exec(s) };

  let pass = 0, fail = 0;
  const check = (lbl, c) => { if (c) { pass++; console.log('  PASS  ' + lbl); } else { fail++; console.log('  FAIL  ' + lbl); } };

  // Local-only verification: do NOT hit NSE during smoke. Stub fetch.
  const origFetch = global.fetch;
  global.fetch = async (url) => {
    if (url === FII_DII_URL) {
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ([{ category: 'FII/FPI', netValue: 1234.5 }]) };
    }
    if (url === BREADTH_URL) {
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ advance: { advances: 300, declines: 200, unchanged: 0 } }) };
    }
    if (url === HIGHS_LOWS_URL) {
      return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ high: { data: new Array(45) }, low: { data: new Array(15) } }) };
    }
    return { ok: true, status: 200, headers: { get: () => null }, text: async () => '<html/>', json: async () => ({}) };
  };

  const f = new NseMacroFetcher({ db: wrapper, log: () => {} });

  (async () => {
    const r = await f.fetchAll();
    check('returned object with 3 fields', r.fiiNetFlow != null && r.marketBreadth != null && r.highLowRatio != null);
    check('fiiNetFlow = 1234.5', Math.abs(r.fiiNetFlow - 1234.5) < 0.01);
    check('marketBreadth = 1.5 (300/200)', Math.abs(r.marketBreadth - 1.5) < 0.001);
    check('highLowRatio = 3.0 (45/15)', Math.abs(r.highLowRatio - 3.0) < 0.001);
    check('errors empty on happy path', r.errors.length === 0);

    const cached = f.cachedLatest();
    check('cachedLatest returns row', cached && cached.fiiNetFlow === 1234.5);

    // Failure mode: NSE returns 403
    global.fetch = async () => ({ ok: false, status: 403, headers: { get: () => null } });
    const r2 = await f.fetchAll();
    check('all-null on 403', r2.fiiNetFlow == null && r2.marketBreadth == null && r2.highLowRatio == null);
    check('errors populated on failure', r2.errors.length === 3);

    // env gate refuses start
    delete process.env.NSE_MACRO_FETCH_ENABLED;
    const started = f.start({ intervalMs: 1000000 });
    check('start refused without env gate', started === false);

    global.fetch = origFetch;
    console.log(`\nSmoke: ${pass} pass, ${fail} fail.`);
    if (fail > 0) process.exit(1);
  })();
};

if (require.main === module && process.argv.includes('--smoke')) {
  SMOKE();
}

module.exports = { NseMacroFetcher };

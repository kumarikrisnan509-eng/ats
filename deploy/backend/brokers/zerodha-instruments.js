// InstrumentsMaster — daily-refreshed Kite instrument master, in-memory.
//
// Kite Connect exposes ~95k instruments. We download the CSV (parsed by the
// kiteconnect lib's getInstruments() helper), build two maps:
//   - byKey:  "NSE:RELIANCE"  -> instrument_token (number)
//   - byTok:  instrument_token -> "NSE:RELIANCE"
// and persist a slim JSON snapshot for fast restart.
//
// Why a separate file: the master is large enough we don't want it in process
// memory of every adapter, and it's broker-specific (Kite). Mock broker doesn't
// need it.

const fs = require('fs');
const path = require('path');

// "NIFTY 50" / "BANKNIFTY" come through the Kite Ticker as index instruments
// living in segment "INDICES" with these well-known tokens. Hardcoding the
// short list of index tokens is safe because indices don't change.
const INDEX_TOKENS = {
  'NIFTY 50':         256265,
  'NIFTY BANK':       260105,
  'BANKNIFTY':        260105, // alias
  'NIFTY FIN SERVICE':257801,
  'FINNIFTY':         257801, // alias
  'NIFTY MIDCAP 100': 256777,
  'INDIA VIX':        264969,
  'SENSEX':           265,    // BSE SENSEX
};

class InstrumentsMaster {
  /**
   * @param {object} opts
   * @param {object} opts.kc                 KiteConnect instance (already auth'd)
   * @param {string} opts.cachePath          where to persist the slim JSON
   * @param {string[]} [opts.exchanges]      which exchanges to pull. Default ['NSE','NFO','BFO','MCX']
   */
  constructor({ kc, cachePath, exchanges }) {
    this.kc = kc;
    this.cachePath = cachePath;
    this.exchanges = exchanges || ['NSE', 'NFO', 'BFO', 'MCX'];
    /** Map<string, number>  e.g. "NSE:RELIANCE" -> 738561 */
    this.byKey = new Map();
    /** Map<number, string>  e.g. 738561 -> "NSE:RELIANCE" */
    this.byTok = new Map();
    /** Map<string, number>  short symbol -> token (uses default exchange resolution) */
    this.byShort = new Map();
    /** Map<token, {strike, lotSize, tickSize, instrumentType, expiry, name, segment, exchange}> */
    this.metaByTok = new Map();
    /** Options index: Map<"NAME|YYYY-MM-DD", Array<{strike, ts, t, it, ls}>> */
    this.optionsByNameExpiry = new Map();
    /** Map<"NAME", Set<"YYYY-MM-DD">> of available option expiries per underlying */
    this.expiriesByName = new Map();
    this.loadedAt = 0;
    this.size = 0;
  }

  /** Try to hydrate from on-disk cache first (saves ~3s on container restart). */
  hydrateFromDisk() {
    try {
      if (!fs.existsSync(this.cachePath)) return false;
      const stat = fs.statSync(this.cachePath);
      // Reject cache older than 24h - instruments do change daily (new F&O contracts, expiries).
      if (Date.now() - stat.mtimeMs > 24 * 3600 * 1000) return false;
      const raw = JSON.parse(fs.readFileSync(this.cachePath, 'utf8'));
      const rows = Array.isArray(raw && raw.rows) ? raw.rows : [];
      // Reject pre-v2 cache (no strike `k` field) so it refreshes with new schema.
      if (rows.length > 0 && !('k' in rows[0]) && !('ls' in rows[0])) {
        console.log('[instruments] disk cache is pre-v2 schema (no strike/lotSize), will refresh');
        return false;
      }
      this._rebuildFromArray(rows);
      this.loadedAt = raw.loadedAt || stat.mtimeMs;
      console.log(`[instruments] hydrated from disk: ${this.size} rows (age ${Math.round((Date.now() - this.loadedAt)/1000)}s)`);
      return true;
    } catch (e) {
      console.warn('[instruments] disk cache hydrate failed:', e.message);
      return false;
    }
  }

  /** Pull fresh from Kite. Requires kc.setAccessToken() already called. */
  async refresh() {
    const startedAt = Date.now();
    const all = [];
    for (const ex of this.exchanges) {
      try {
        // kc.getInstruments(exchange) returns array of { instrument_token, tradingsymbol, exchange, ... }
        const rows = await this.kc.getInstruments(ex);
        if (Array.isArray(rows)) {
          for (const r of rows) {
            all.push({
              t:   Number(r.instrument_token),
              ts:  String(r.tradingsymbol || ''),
              x:   String(r.exchange || ex),
              s:   String(r.segment || ''),
              n:   String(r.name || ''),
              it:  String(r.instrument_type || ''),
              ed:  r.expiry ? String(r.expiry) : '',
              k:   typeof r.strike === 'number' ? r.strike : (r.strike ? Number(r.strike) : 0),
              ls:  typeof r.lot_size === 'number' ? r.lot_size : (r.lot_size ? Number(r.lot_size) : 0),
              ti:  typeof r.tick_size === 'number' ? r.tick_size : (r.tick_size ? Number(r.tick_size) : 0),
            });
          }
        }
      } catch (e) {
        console.warn(`[instruments] getInstruments(${ex}) failed:`, e.message);
      }
    }

    if (all.length === 0) {
      // Don't overwrite a good in-memory map with an empty pull.
      console.warn('[instruments] refresh returned 0 rows — keeping previous map');
      return;
    }

    this._rebuildFromArray(all);
    this.loadedAt = Date.now();

    // Persist a slim cache so the next container restart is instant.
    try {
      fs.mkdirSync(path.dirname(this.cachePath), { recursive: true });
      fs.writeFileSync(this.cachePath, JSON.stringify({
        loadedAt: this.loadedAt,
        exchanges: this.exchanges,
        rows: all,
      }));
    } catch (e) {
      console.warn('[instruments] cache write failed:', e.message);
    }

    console.log(`[instruments] refresh OK: ${this.size} rows from ${this.exchanges.join(',')} in ${Date.now() - startedAt}ms`);
  }

  _rebuildFromArray(arr) {
    this.byKey.clear();
    this.byTok.clear();
    this.byShort.clear();
    this.metaByTok.clear();
    this.optionsByNameExpiry.clear();
    this.expiriesByName.clear();

    // Add index tokens first so they win short-name lookup.
    for (const [name, tok] of Object.entries(INDEX_TOKENS)) {
      this.byTok.set(tok, name);
      this.byShort.set(name, tok);
    }

    for (const r of arr) {
      const key = `${r.x}:${r.ts}`;
      this.byKey.set(key, r.t);
      this.byTok.set(r.t, key);
      // Short-name lookup. Prefer NSE cash over NFO/BFO/MCX (so "RELIANCE" -> NSE:RELIANCE).
      if (!this.byShort.has(r.ts) || r.x === 'NSE') {
        this.byShort.set(r.ts, r.t);
      }
      // Metadata
      this.metaByTok.set(r.t, {
        token: r.t,
        tradingsymbol: r.ts,
        exchange: r.x,
        segment: r.s,
        name: r.n,
        instrumentType: r.it,
        expiry: r.ed || null,
        strike: r.k || 0,
        lotSize: r.ls || 0,
        tickSize: r.ti || 0,
      });
      // Options index: only OPT segments with a valid name+expiry.
      if ((r.s === 'NFO-OPT' || r.s === 'BFO-OPT') && r.n && r.ed && (r.it === 'CE' || r.it === 'PE')) {
        const key = `${r.n}|${r.ed}`;
        if (!this.optionsByNameExpiry.has(key)) this.optionsByNameExpiry.set(key, []);
        this.optionsByNameExpiry.get(key).push({
          strike: r.k || 0,
          tradingsymbol: r.ts,
          token: r.t,
          instrumentType: r.it,
          lotSize: r.ls || 0,
          exchange: r.x,
        });
        if (!this.expiriesByName.has(r.n)) this.expiriesByName.set(r.n, new Set());
        this.expiriesByName.get(r.n).add(r.ed);
      }
    }
    this.size = arr.length;
  }

  /**
   * List available option expiries for an underlying.
   * @param {string} underlying e.g. "NIFTY", "BANKNIFTY", "RELIANCE"
   * @returns {string[]} ISO dates sorted ascending
   */
  listExpiries(underlying) {
    const set = this.expiriesByName.get(underlying);
    if (!set) return [];
    return Array.from(set).sort();
  }

  /**
   * Get the full option chain (CE + PE for every strike) for an underlying + expiry.
   * @returns {Array<{strike, ce: {tradingsymbol,token,lotSize}|null, pe: similar}>}  sorted by strike asc
   */
  optionsFor(underlying, expiry) {
    const list = this.optionsByNameExpiry.get(`${underlying}|${expiry}`);
    if (!list) return [];
    const byStrike = new Map();
    for (const r of list) {
      if (!byStrike.has(r.strike)) byStrike.set(r.strike, { strike: r.strike, ce: null, pe: null });
      const slot = byStrike.get(r.strike);
      const leg = { tradingsymbol: r.tradingsymbol, token: r.token, lotSize: r.lotSize, exchange: r.exchange };
      if (r.instrumentType === 'CE') slot.ce = leg;
      else if (r.instrumentType === 'PE') slot.pe = leg;
    }
    return Array.from(byStrike.values()).sort((a, b) => a.strike - b.strike);
  }

  /** Metadata for a token (segment, lot, ISIN-not-available, etc.) */
  metaFor(token) {
    return this.metaByTok.get(Number(token)) || null;
  }

  /**
   * Resolve a symbol to an instrument_token. Accepts:
   *   - "NSE:RELIANCE"        (preferred, full key)
   *   - "RELIANCE"            (short — uses byShort map)
   *   - "NIFTY 50" / etc      (index — via INDEX_TOKENS)
   *   - "TOKEN:738561"        (raw passthrough, for power users)
   * @returns {number|null}
   */
  tokenOf(symbol) {
    if (!symbol) return null;
    if (typeof symbol === 'number') return symbol;
    if (typeof symbol !== 'string') return null;
    if (symbol.startsWith('TOKEN:')) {
      const n = Number(symbol.slice(6));
      return Number.isFinite(n) ? n : null;
    }
    if (symbol.includes(':')) {
      return this.byKey.get(symbol) || null;
    }
    return this.byShort.get(symbol) || null;
  }

  /**
   * Reverse lookup: instrument_token -> "NSE:RELIANCE" form.
   * @param {number} tok
   * @returns {string|null}
   */
  symbolOf(tok) {
    if (tok == null) return null;
    return this.byTok.get(Number(tok)) || null;
  }

  /** Quick stats for /api/health */
  stats() {
    return {
      size: this.size,
      loadedAt: this.loadedAt,
      ageSec: this.loadedAt ? Math.floor((Date.now() - this.loadedAt) / 1000) : null,
    };
  }

  /**
   * Schedule a daily refresh at 06:00 IST (00:30 UTC).
   * Kite publishes a fresh instruments dump around 5:30 AM IST every market day.
   */
  scheduleDailyRefresh() {
    const computeDelay = () => {
      // 06:00 IST = 00:30 UTC
      const now = new Date();
      const target = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 30, 0));
      if (target.getTime() <= now.getTime()) {
        target.setUTCDate(target.getUTCDate() + 1);
      }
      return target.getTime() - now.getTime();
    };
    const arm = () => {
      const ms = computeDelay();
      setTimeout(async () => {
        try { await this.refresh(); } catch (e) { console.error('[instruments] scheduled refresh failed:', e.message); }
        arm();
      }, ms).unref();
    };
    arm();
  }
}

module.exports = { InstrumentsMaster, INDEX_TOKENS };

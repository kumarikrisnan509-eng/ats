// watchlist.js — persistent symbol watchlist.
//
// One single watchlist for now (single-user prod). Future: per-user lists keyed
// by session/userId. Storage matches the alerts/instruments pattern: a
// JSON file inside the bind-mounted tokens dir, underscore-prefixed so
// sessions.js doesn't treat it as a user-token file.
//
// API stays minimal: get, set (replace whole list), add one, remove one.
// Symbols are stored as canonical short strings (e.g. "RELIANCE", "NIFTY 50").
// The broker's instrument master resolves them to Kite tokens at subscribe time.

const fs   = require('fs');
const path = require('path');

const DEFAULT_STORE = '/var/lib/ats/tokens/_watchlist.json';
const MAX_SYMBOLS = 200;

class Watchlist {
  constructor({ storePath, audit } = {}) {
    this.storePath = storePath || DEFAULT_STORE;
    this.audit = audit || (() => {});
    this._symbols = [];
    this._loadedAt = 0;
  }

  load() {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      if (Array.isArray(raw && raw.symbols)) {
        this._symbols = raw.symbols.filter(s => typeof s === 'string' && s.length > 0).slice(0, MAX_SYMBOLS);
        this._loadedAt = Date.now();
        console.log(`[watchlist] loaded ${this._symbols.length} symbols from ${this.storePath}`);
      }
    } catch (e) {
      console.warn('[watchlist] load failed:', e.message);
    }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify({ symbols: this._symbols }, null, 2));
    } catch (e) {
      console.error('[watchlist] persist failed:', e.message);
    }
  }

  list() {
    return this._symbols.slice();
  }

  /** Replace the entire watchlist. Dedupes. */
  set(symbols) {
    if (!Array.isArray(symbols)) throw new Error('symbols must be an array');
    const cleaned = [];
    const seen = new Set();
    for (const s of symbols) {
      if (typeof s !== 'string') continue;
      const t = s.trim();
      if (!t) continue;
      const key = t.toUpperCase();
      if (seen.has(key)) continue;
      seen.add(key);
      cleaned.push(t);
      if (cleaned.length >= MAX_SYMBOLS) break;
    }
    this._symbols = cleaned;
    this._persist();
    this.audit('watchlist.set', { count: cleaned.length });
    return this.list();
  }

  add(symbol) {
    if (typeof symbol !== 'string' || !symbol.trim()) throw new Error('symbol required');
    const t = symbol.trim();
    const exists = this._symbols.some(x => x.toUpperCase() === t.toUpperCase());
    if (exists) return { added: false, list: this.list() };
    if (this._symbols.length >= MAX_SYMBOLS) throw new Error(`watchlist full (max ${MAX_SYMBOLS})`);
    this._symbols.push(t);
    this._persist();
    this.audit('watchlist.add', { symbol: t });
    return { added: true, list: this.list() };
  }

  remove(symbol) {
    if (typeof symbol !== 'string' || !symbol.trim()) throw new Error('symbol required');
    const target = symbol.trim().toUpperCase();
    const before = this._symbols.length;
    this._symbols = this._symbols.filter(s => s.toUpperCase() !== target);
    const removed = this._symbols.length < before;
    if (removed) {
      this._persist();
      this.audit('watchlist.remove', { symbol: symbol.trim() });
    }
    return { removed, list: this.list() };
  }

  stats() {
    return {
      count: this._symbols.length,
      max: MAX_SYMBOLS,
      loadedAt: this._loadedAt,
    };
  }
}

module.exports = { Watchlist };

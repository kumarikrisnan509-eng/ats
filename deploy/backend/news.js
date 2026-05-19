// news.js -- RSS-based news ingestion + watchlist symbol-tagging.
//
// Polls a small set of Indian-market RSS sources every ~10 minutes, parses
// the feed XML inline (no new deps), deduplicates by URL hash, and tags
// each item with watchlist symbols found in title+summary.
//
// State persists to /var/lib/ats/tokens/_news.json (last 200 items).
//
// Default sources (override via NEWS_RSS env, comma-separated):
//   - Moneycontrol markets
//   - Mint markets
//   - Economic Times markets
//
// API surface used by server.js:
//   const n = new NewsFeed({ watchlist, audit, storePath });
//   n.load();
//   n.start();   // initial fetch + 10-min interval
//   n.list({ limit, symbol })  -> items
//   n.stats()                  -> { count, lastFetchAt, sources, ... }
//   n.refresh()                -> manual fetch trigger

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_STORE = '/var/lib/ats/tokens/_news.json';
const HISTORY_MAX = 200;
const FETCH_INTERVAL_MS = 10 * 60 * 1000;
const FETCH_TIMEOUT_MS = 12000;

const DEFAULT_SOURCES = [
  { name: 'Moneycontrol',   url: 'https://www.moneycontrol.com/rss/marketreports.xml' },
  { name: 'Mint Markets',   url: 'https://www.livemint.com/rss/markets' },
  { name: 'ET Markets',     url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms' },
];

class NewsFeed {
  /**
   * @param {object} opts
   * @param {object} opts.watchlist           Watchlist instance (provides .list())
   * @param {(event,data)=>void} [opts.audit]
   * @param {string} [opts.storePath]
   * @param {Array<{name:string,url:string}>} [opts.sources]
   */
  constructor({ watchlist, audit, storePath, sources } = {}) {
    this.watchlist  = watchlist;
    this.audit      = audit || (() => {});
    this.storePath  = storePath || DEFAULT_STORE;
    this.sources    = Array.isArray(sources) && sources.length ? sources : DEFAULT_SOURCES;
    this._items     = [];                 // newest-first
    this._seenIds   = new Set();          // url hashes
    this._timer     = null;
    this._inflight  = false;
    this._lastFetchAt = null;
    this._lastFetchSummary = null;
  }

  load() {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      if (raw && Array.isArray(raw.items)) {
        this._items = raw.items.slice(0, HISTORY_MAX);
        this._seenIds = new Set(this._items.map(i => i.id));
        this._lastFetchAt = raw.lastFetchAt || null;
        console.log(`[news] loaded ${this._items.length} items`);
      }
    } catch (e) { console.warn('[news] load failed:', e.message); }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify({
        items: this._items.slice(0, HISTORY_MAX),
        lastFetchAt: this._lastFetchAt,
      }, null, 2));
    } catch (e) { console.error('[news] persist failed:', e.message); }
  }

  // ---- minimal RSS 2.0 parser (regex-based, tolerates Atom feeds too) ----
  _parseXml(xml) {
    if (!xml || typeof xml !== 'string') return [];
    // Match RSS <item>...</item> OR Atom <entry>...</entry>
    const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/g) || [];
    const out = [];
    for (const block of blocks) {
      const title       = this._tag(block, 'title');
      const linkRss     = this._tag(block, 'link');
      const linkAtom    = (block.match(/<link[^>]*href="([^"]+)"/i) || [])[1];
      const link        = (linkRss && linkRss.startsWith('http')) ? linkRss : linkAtom || linkRss;
      const description = this._tag(block, 'description') || this._tag(block, 'summary') || this._tag(block, 'content');
      const pubDate     = this._tag(block, 'pubDate') || this._tag(block, 'published') || this._tag(block, 'updated');
      if (!title || !link) continue;
      out.push({
        title:       this._clean(title),
        link:        link.trim(),
        summary:     this._clean(description || '').slice(0, 400),
        pubDate:     pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      });
    }
    return out;
  }

  _tag(block, name) {
    // Try CDATA-wrapped first, then plain
    const cdata = block.match(new RegExp(`<${name}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*<\\/${name}>`, 'i'));
    if (cdata) return cdata[1];
    const plain = block.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)<\\/${name}>`, 'i'));
    return plain ? plain[1] : null;
  }

  _clean(s) {
    return String(s || '')
      .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/\s+/g, ' ')
      .trim();
  }

  _idFor(link) {
    return crypto.createHash('sha1').update(link).digest('hex').slice(0, 16);
  }

  /**
   * Tag an item with watchlist symbols whose name appears as a whole word in
   * the title+summary. Case-insensitive. Returns an array of symbol strings.
   */
  _tagSymbols(item) {
    if (!this.watchlist || typeof this.watchlist.list !== 'function') return [];
    const symbols = this.watchlist.list() || [];
    if (!symbols.length) return [];
    const text = (item.title + ' ' + (item.summary || '')).toUpperCase();
    const out = [];
    for (const s of symbols) {
      if (!s || typeof s !== 'string') continue;
      const sym = s.toUpperCase();
      // Use word-boundary match. RegExp escape to handle any odd chars.
      const re = new RegExp('\\b' + sym.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b');
      if (re.test(text)) out.push(s);
    }
    return out;
  }

  /** Fetch one source. Returns {items, error?}. */
  async _fetchSource(src) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
      const res = await fetch(src.url, { signal: ctrl.signal, headers: { 'User-Agent': 'ats-news/1.0' } });
      clearTimeout(timer);
      if (!res.ok) return { items: [], error: `${res.status} ${res.statusText}` };
      const xml = await res.text();
      const parsed = this._parseXml(xml);
      return { items: parsed.map(i => ({ ...i, source: src.name })) };
    } catch (e) {
      return { items: [], error: e.message };
    }
  }

  async refresh() {
    if (this._inflight) return { skipped: true, reason: 'in_flight' };
    this._inflight = true;
    const t0 = Date.now();
    const perSource = [];
    let newCount = 0;
    try {
      const results = await Promise.all(this.sources.map(s => this._fetchSource(s)));
      for (let i = 0; i < this.sources.length; i++) {
        const src = this.sources[i];
        const r = results[i];
        perSource.push({ source: src.name, count: r.items.length, error: r.error || null });
        for (const it of r.items) {
          const id = this._idFor(it.link);
          if (this._seenIds.has(id)) continue;
          this._seenIds.add(id);
          const item = {
            id,
            source:  it.source,
            title:   it.title,
            link:    it.link,
            summary: it.summary,
            pubDate: it.pubDate,
            ingestedAt: new Date().toISOString(),
            symbols: this._tagSymbols(it),
          };
          this._items.unshift(item);
          newCount++;
        }
      }
      // Cap and re-sort by pubDate desc
      this._items.sort((a, b) => (b.pubDate || '').localeCompare(a.pubDate || ''));
      if (this._items.length > HISTORY_MAX) this._items = this._items.slice(0, HISTORY_MAX);
      this._lastFetchAt = new Date().toISOString();
      this._lastFetchSummary = { newCount, perSource, durationMs: Date.now() - t0 };
      this._persist();
      this.audit('news.refresh', { newCount, perSource });
    } catch (e) {
      this.audit('news.refresh.error', { msg: e.message });
    } finally {
      this._inflight = false;
    }
    return this._lastFetchSummary;
  }

  list({ limit, symbol, source } = {}) {
    const n = Math.max(1, Math.min(HISTORY_MAX, parseInt(limit || 50, 10) || 50));
    let items = this._items;
    if (symbol) {
      const s = String(symbol).toUpperCase();
      items = items.filter(it => Array.isArray(it.symbols) && it.symbols.some(x => x.toUpperCase() === s));
    }
    if (source) {
      const s = String(source).toLowerCase();
      items = items.filter(it => it.source && it.source.toLowerCase() === s);
    }
    return items.slice(0, n);
  }

  stats() {
    const taggedCount = this._items.filter(i => Array.isArray(i.symbols) && i.symbols.length > 0).length;
    return {
      count:        this._items.length,
      taggedCount,
      lastFetchAt:  this._lastFetchAt,
      lastSummary:  this._lastFetchSummary,
      sources:      this.sources.map(s => s.name),
      timerArmed:   !!this._timer,
    };
  }

  start() {
    // Initial fetch on boot (don't block init)
    this.refresh().catch(e => console.warn('[news] promise rejected:', e && e.message));
    if (this._timer) clearInterval(this._timer);
    this._timer = setInterval(() => {
      this.refresh().catch(e => console.warn('[news] promise rejected:', e && e.message));
    }, FETCH_INTERVAL_MS);
    this._timer.unref();
  }

  stop() { if (this._timer) { clearInterval(this._timer); this._timer = null; } }
}

module.exports = { NewsFeed };

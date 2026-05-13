// ZerodhaBroker — Kite Connect implementation of BrokerGateway.
//
// Provides realtime market data via the Kite Ticker WebSocket. Read-only.
// Does NOT call any order endpoint. When you wire order placement later, do it
// in a subclass with explicit gating; do not extend this file in-place.
//
// Auth flow (Indian retail standard):
//   1. buildLoginUrl()  -> https://kite.zerodha.com/connect/login?api_key=...&v=3
//   2. User logs into Kite, TOTP, redirects back to .../callback?request_token=...
//   3. exchangeRequestToken(requestToken) -> { accessToken, publicToken, userId, ... }
//   4. Backend encrypts and stores per-user token
//   5. setAccessToken() -> kicks off instrument-master load + ticker connect
//   6. Ticker emits raw ticks; we translate to canonical {symbol, ltp, ts, change, changePct}
//
// Requires `kiteconnect` npm package. The package's KiteTicker is a server-side WebSocket
// client (Node `ws`-based). One connection per access_token; up to 3000 instruments per WS.
//
// Daily expiry: access_token expires ~6:00 IST every day. Detect 403 from REST, mark the
// user "needs reconnect", and have the UI surface a Reconnect button.

const path = require('path');
const { BrokerGateway } = require('./gateway');
const { InstrumentsMaster } = require('./zerodha-instruments');

let KiteConnect, KiteTicker;
try {
  // Optional dependency — only required when BROKER=zerodha
  ({ KiteConnect, KiteTicker } = require('kiteconnect'));
} catch (_e) {
  // Will throw a clear error if zerodha is selected without the package installed.
}

class ZerodhaBroker extends BrokerGateway {
  /**
   * @param {object} opts
   * @param {string} opts.apiKey
   * @param {string} opts.apiSecret
   * @param {string} opts.redirectUrl  e.g. https://rajasekarselvam.com/api/brokers/zerodha/callback
   * @param {string} [opts.instrumentsCachePath]  default /var/lib/ats/instruments-cache.json
   */
  constructor({ apiKey, apiSecret, redirectUrl, instrumentsCachePath }) {
    super();
    if (!KiteConnect) {
      throw new Error('kiteconnect package not installed. Run `npm install` in deploy/backend/.');
    }
    if (!apiKey || !apiSecret) {
      throw new Error('ZerodhaBroker requires apiKey and apiSecret');
    }
    this.apiKey = apiKey;
    this.apiSecret = apiSecret;
    this.redirectUrl = redirectUrl;

    this.kc = new KiteConnect({ api_key: apiKey });

    // Instrument master — resolves canonical symbols to Kite instrument_tokens.
    // Cache lives in the bind-mounted tokens dir; underscore prefix keeps sessions.js
    // from treating it as a per-user token file.
    this.instruments = new InstrumentsMaster({
      kc: this.kc,
      cachePath: instrumentsCachePath || '/var/lib/ats/tokens/_instruments-cache.json',
    });
    // Try disk hydrate immediately so even pre-auth health endpoints can introspect.
    this.instruments.hydrateFromDisk();

    /** @type {string|null} */
    this.accessToken = null;
    /** @type {KiteTicker|null} */
    this.ticker = null;
    /** @type {Set<(tick)=>void>} */
    this._subs = new Set();
    /** @type {Set<number>} */
    this._subscribedTokens = new Set();
    /** Last-seen LTPs per symbol for change-pct calc */
    this._lastLtp = new Map();
    /** Reconnect bookkeeping */
    this._connected = false;
    this._reconnectAttempts = 0;
    /** Heartbeat — if no tick within HEARTBEAT_MS while market open, mark stale */
    this._lastTickAt = 0;
  }

  get name() { return 'zerodha'; }

  buildLoginUrl() {
    return this.kc.getLoginURL();
  }

  /**
   * Exchange the one-time request_token (from the Kite OAuth redirect) for a daily access_token.
   * @param {string} requestToken
   * @returns {Promise<{accessToken:string, publicToken:string, userId:string}>}
   */
  async exchangeRequestToken(requestToken) {
    const session = await this.kc.generateSession(requestToken, this.apiSecret);
    return {
      accessToken: session.access_token,
      publicToken: session.public_token,
      userId: session.user_id,
      userName: session.user_name,
      userEmail: session.email,
      brokerSession: session, // full payload for audit
    };
  }

  /** Hydrate this adapter with a stored access token (e.g. on backend restart). */
  setAccessToken(accessToken) {
    this.accessToken = accessToken;
    this.kc.setAccessToken(accessToken);

    // Kick off instrument-master refresh in the background (don't await — slow on first run).
    // After this resolves, future symbol->token lookups work for all of NSE+NFO+BFO+MCX.
    this.instruments.refresh()
      .then(() => this.instruments.scheduleDailyRefresh())
      .catch((err) => console.error('[zerodha] instruments refresh failed:', err && err.message));

    // If start() was deferred earlier (no token at boot), kick off the ticker now.
    if (!this.ticker) {
      this.start().catch((err) =>
        console.error('[zerodha] deferred start() failed after setAccessToken:', err && err.message)
      );
    }
  }

  async start() {
    if (!this.accessToken) {
      // No token yet (first-time deploy before user OAuth). Defer KiteTicker init —
      // it will be created when setAccessToken() is called after the OAuth callback.
      console.log('[zerodha] start() deferred: no access token yet, awaiting OAuth at /api/brokers/zerodha/login');
      return;
    }
    if (this.ticker) return;

    this.ticker = new KiteTicker({
      api_key: this.apiKey,
      access_token: this.accessToken,
    });

    this.ticker.on('connect', () => {
      this._connected = true;
      this._reconnectAttempts = 0;
      // Re-subscribe to anything we had before disconnect.
      if (this._subscribedTokens.size > 0) {
        const tokens = Array.from(this._subscribedTokens);
        this.ticker.subscribe(tokens);
        this.ticker.setMode(this.ticker.modeQuote, tokens);
      }
    });

    this.ticker.on('disconnect', () => {
      this._connected = false;
    });

    this.ticker.on('reconnect', (_err, attempts) => {
      this._reconnectAttempts = attempts;
    });

    this.ticker.on('ticks', (ticks) => {
      this._lastTickAt = Date.now();
      for (const t of ticks) {
        // Resolve token back to a friendly symbol. Prefer the instruments master,
        // fall back to TOKEN:n.
        const fullSym = this.instruments.symbolOf(t.instrument_token);
        // Strip "NSE:" prefix for the frontend's existing simple symbol scheme,
        // but keep INDICES names intact ("NIFTY 50", "BANKNIFTY", etc).
        let symbol = fullSym || `TOKEN:${t.instrument_token}`;
        if (fullSym && fullSym.startsWith('NSE:')) symbol = fullSym.slice(4);

        const ltp = typeof t.last_price === 'number' ? t.last_price : null;
        if (ltp == null) continue;
        const prev = this._lastLtp.get(symbol);
        this._lastLtp.set(symbol, ltp);
        const change = prev != null ? +(ltp - prev).toFixed(2) : 0;
        const changePct = prev != null && prev > 0 ? +(((ltp - prev) / prev) * 100).toFixed(4) : 0;
        const tick = { symbol, ltp, ts: Date.now(), change, changePct };
        for (const cb of this._subs) {
          try { cb(tick); } catch { /* don't kill the loop */ }
        }
      }
    });

    this.ticker.on('error', (err) => {
      console.error('[zerodha] ticker error:', err && err.message);
    });

    this.ticker.connect();
  }

  async stop() {
    if (this.ticker) {
      try { this.ticker.disconnect(); } catch {}
      this.ticker = null;
    }
    this._subs.clear();
    this._subscribedTokens.clear();
    this._connected = false;
  }

  /**
   * Subscribe to a list of canonical symbols. Adapter resolves them to instrument_tokens
   * via the InstrumentsMaster. Accepts:
   *   - "NSE:RELIANCE"  (preferred)
   *   - "RELIANCE"      (short — resolves to NSE)
   *   - "NIFTY 50"      (index)
   *   - "TOKEN:738561"  (raw passthrough)
   */
  async subscribeTicks(symbols, onTick) {
    this._subs.add(onTick);

    const tokens = (symbols || [])
      .map((s) => this.instruments.tokenOf(s))
      .filter((t) => Number.isFinite(t));

    // Dedupe against currently-subscribed set
    const newTokens = tokens.filter((t) => !this._subscribedTokens.has(t));
    for (const t of tokens) this._subscribedTokens.add(t);

    if (newTokens.length > 0 && this.ticker && this._connected) {
      this.ticker.subscribe(newTokens);
      this.ticker.setMode(this.ticker.modeQuote, newTokens);
    }
    // Otherwise tokens are queued in _subscribedTokens; the 'connect' handler will pick them up.

    return () => { this._subs.delete(onTick); };
  }

  /**
   * Subscribe additional symbols to an EXISTING fan-out (no new onTick callback added).
   * Used by /ws handler when a client says {type:"subscribe",symbols:[...]}.
   */
  async ensureSubscribed(symbols) {
    const tokens = (symbols || [])
      .map((s) => this.instruments.tokenOf(s))
      .filter((t) => Number.isFinite(t));
    const newTokens = tokens.filter((t) => !this._subscribedTokens.has(t));
    for (const t of newTokens) this._subscribedTokens.add(t);
    if (newTokens.length > 0 && this.ticker && this._connected) {
      this.ticker.subscribe(newTokens);
      this.ticker.setMode(this.ticker.modeQuote, newTokens);
    }
    return { requested: symbols.length, resolved: tokens.length, newlySubscribed: newTokens.length };
  }

  async getQuote(symbol) {
    if (!this.accessToken) throw new Error('not authenticated');
    // For real symbols, format is "NSE:RELIANCE" etc.
    const key = symbol.includes(':') ? symbol : `NSE:${symbol}`;
    const q = await this.kc.getLTP([key]);
    const row = q[key];
    if (!row) throw new Error(`no quote for ${symbol}`);
    return { ltp: row.last_price, ts: Date.now() };
  }

  /**
   * Bulk quote — returns { "NSE:RELIANCE": {ltp, ohlc, ...}, ... }
   * Pass symbols in either "RELIANCE" or "NSE:RELIANCE" form.
   */
  async getQuotes(symbols) {
    if (!this.accessToken) throw new Error('not authenticated');
    const keys = (symbols || []).map(s => s.includes(':') ? s : `NSE:${s}`);
    if (keys.length === 0) return {};
    return await this.kc.getQuote(keys);
  }

  async listSymbols() {
    // In production: cache the instruments master dump (refreshed at 6am IST).
    // For the scaffold: return what we currently have LTPs for, falling back to short names from master.
    const live = Array.from(this._lastLtp.keys());
    if (live.length > 0) return live;
    return Array.from(this.instruments.byShort.keys()).slice(0, 500);
  }

  // ------------------ Read-only account data ------------------

  async getHoldings() {
    if (!this.accessToken) throw new Error('not authenticated');
    const rows = await this.kc.getHoldings();
    // Normalize to the shape the frontend expects.
    return (rows || []).map((h) => ({
      symbol:        h.tradingsymbol,
      exchange:      h.exchange,
      quantity:      h.quantity,
      avgPrice:      h.average_price,
      ltp:           h.last_price,
      pnl:           h.pnl,
      dayChange:     h.day_change,
      dayChangePct:  h.day_change_percentage,
      isin:          h.isin,
      product:       h.product,
    }));
  }

  async getPositions() {
    if (!this.accessToken) throw new Error('not authenticated');
    const data = await this.kc.getPositions();
    const norm = (rows) => (rows || []).map((p) => ({
      symbol:       p.tradingsymbol,
      exchange:     p.exchange,
      product:      p.product,
      quantity:     p.quantity,
      avgPrice:     p.average_price,
      ltp:          p.last_price,
      pnl:          p.pnl,
      m2m:          p.m2m,
      unrealised:   p.unrealised,
      realised:     p.realised,
      multiplier:   p.multiplier,
    }));
    return { net: norm(data && data.net), day: norm(data && data.day) };
  }

  async getOrders() {
    if (!this.accessToken) throw new Error('not authenticated');
    const rows = await this.kc.getOrders();
    return (rows || []).map((o) => ({
      orderId:       o.order_id,
      exchangeOrder: o.exchange_order_id,
      status:        o.status,
      symbol:        o.tradingsymbol,
      exchange:      o.exchange,
      transactionType: o.transaction_type,
      product:       o.product,
      orderType:     o.order_type,
      variety:       o.variety,
      quantity:      o.quantity,
      filledQuantity:o.filled_quantity,
      pendingQuantity:o.pending_quantity,
      price:         o.price,
      averagePrice:  o.average_price,
      triggerPrice:  o.trigger_price,
      placedAt:      o.order_timestamp,
      statusMessage: o.status_message,
    }));
  }

  async getProfile() {
    if (!this.accessToken) throw new Error('not authenticated');
    const p = await this.kc.getProfile();
    return {
      userId:    p.user_id,
      userName:  p.user_name,
      userType:  p.user_type,
      email:     p.email,
      broker:    p.broker,
      products:  p.products,
      exchanges: p.exchanges,
      orderTypes:p.order_types,
    };
  }

  async getMargins() {
    if (!this.accessToken) throw new Error('not authenticated');
    return await this.kc.getMargins();
  }

  /**
   * Historical OHLCV candles for a symbol.
   * Requires the Kite Connect "Historical Data" subscription (included in Connect plan).
   *
   * @param {object} args
   * @param {string} args.symbol   short or "EXCH:SYM" — resolved via InstrumentsMaster.
   * @param {string} args.interval one of: minute, 3minute, 5minute, 10minute, 15minute, 30minute, 60minute, day
   * @param {string} args.from     ISO date (YYYY-MM-DD) or full ISO timestamp
   * @param {string} args.to       ISO date (YYYY-MM-DD) or full ISO timestamp
   * @param {boolean} [args.continuous] continuous data for F&O
   * @param {boolean} [args.oi]         include OI for F&O
   * @returns {Promise<Array<{date:string,open:number,high:number,low:number,close:number,volume:number}>>}
   */
  async getHistorical({ symbol, interval, from, to, continuous, oi }) {
    if (!this.accessToken) throw new Error('not authenticated');
    if (!symbol)   throw new Error('symbol required');
    if (!interval) throw new Error('interval required');
    if (!from || !to) throw new Error('from and to required');

    const VALID = new Set(['minute','3minute','5minute','10minute','15minute','30minute','60minute','day']);
    if (!VALID.has(interval)) throw new Error(`interval must be one of: ${[...VALID].join(', ')}`);

    const token = this.instruments.tokenOf(symbol);
    if (!token) throw new Error(`unknown symbol: ${symbol}`);

    const rows = await this.kc.getHistoricalData(token, interval, from, to, !!continuous, !!oi);
    return (rows || []).map((r) => ({
      date:   r.date instanceof Date ? r.date.toISOString() : String(r.date),
      open:   r.open,
      high:   r.high,
      low:    r.low,
      close:  r.close,
      volume: r.volume,
      ...(oi ? { oi: r.oi } : {}),
    }));
  }

  /**
   * Search the in-memory instrument master.
   * @param {string} q  case-insensitive substring against tradingsymbol AND name
   * @param {number} [limit=20]
   * @returns {Array<{symbol:string, token:number, exchange:string, name?:string, segment?:string, instrumentType?:string, expiry?:string}>}
   */
  searchInstruments(q, limit) {
    if (!q || typeof q !== 'string') return [];
    const needle = q.trim().toUpperCase();
    if (needle.length < 1) return [];
    const cap = Math.max(1, Math.min(100, limit || 20));
    const seen = new Set();
    const out = [];

    // Walk byKey ("NSE:RELIANCE" -> token). The master persists raw rows we
    // discarded after building maps; cheapest path is matching on the key string.
    for (const [key, tok] of this.instruments.byKey) {
      if (out.length >= cap) break;
      if (seen.has(tok)) continue;
      const upper = key.toUpperCase();
      if (upper.includes(needle)) {
        const [exchange, ts] = key.split(':');
        out.push({ symbol: ts, token: tok, exchange });
        seen.add(tok);
      }
    }
    return out;
  }

  /** Health snapshot for /api/health */
  health() {
    return {
      name: this.name,
      connected: this._connected,
      subscribers: this._subs.size,
      subscribedInstruments: this._subscribedTokens.size,
      reconnectAttempts: this._reconnectAttempts,
      lastTickAt: this._lastTickAt,
      lagMs: this._lastTickAt ? Date.now() - this._lastTickAt : null,
      hasAccessToken: !!this.accessToken,
      tickerInitialized: !!this.ticker,
      instruments: this.instruments.stats(),
    };
  }
}

module.exports = { ZerodhaBroker };

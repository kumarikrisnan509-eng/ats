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
//   5. start() connects KiteTicker with that token, subscribes to instrument tokens
//   6. Ticker emits raw ticks; we translate to canonical {symbol, ltp, ts, change, changePct}
//
// Requires `kiteconnect` npm package. The package's KiteTicker is a server-side WebSocket
// client (Node `ws`-based). One connection per access_token; up to 3000 instruments per WS.
//
// Daily expiry: access_token expires ~6:00 IST every day. Detect 403 from REST, mark the
// user "needs reconnect", and have the UI surface a Reconnect button.

const { BrokerGateway } = require('./gateway');

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
   * @param {(symbolOrToken: string|number) => string|null} [opts.symbolForToken]
   *   Map instrument_token (number) -> canonical symbol. Fed by instrument-master sync.
   */
  constructor({ apiKey, apiSecret, redirectUrl, symbolForToken }) {
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
    this.symbolForToken = symbolForToken || ((t) => `TOKEN:${t}`);

    this.kc = new KiteConnect({ api_key: apiKey });
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
        const symbol = this.symbolForToken(t.instrument_token) || `TOKEN:${t.instrument_token}`;
        const ltp = typeof t.last_price === 'number' ? t.last_price : null;
        if (ltp == null) continue;
        const prev = this._lastLtp.get(symbol);
        this._lastLtp.set(symbol, ltp);
        const change = prev != null ? +(ltp - prev).toFixed(2) : 0;
        const changePct = prev != null && prev > 0 ? +(((ltp - prev) / prev) * 100).toFixed(4) : 0;
        const tick = { symbol, ltp, ts: Date.now(), change, changePct, raw: t };
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

  /** Health snapshot for /api/health */
  health() {
    return {
      name: this.name,
      connected: this._connected,
      subscribers: this._subs.size,
      hasAccessToken: !!this.accessToken,
      tickerInitialized: !!this.ticker,
    };
  }

  /**
   * Subscribe to a list of canonical symbols. Adapter resolves them to instrument_tokens
   * via the instrument master (caller-supplied via the constructor).
   *
   * For this scaffold, callers can pass instrument tokens directly as `TOKEN:<n>` strings,
   * which is how the mock symbolForToken renders them. Wire a real instrument master in
   * a later step.
   */
  async subscribeTicks(symbols, onTick) {
    this._subs.add(onTick);

    const tokens = symbols
      .map((s) => (typeof s === 'string' && s.startsWith('TOKEN:')) ? Number(s.slice(6)) : null)
      .filter((t) => Number.isFinite(t));

    if (tokens.length > 0 && this.ticker && this._connected) {
      for (const t of tokens) this._subscribedTokens.add(t);
      this.ticker.subscribe(tokens);
      this.ticker.setMode(this.ticker.modeQuote, tokens);
    } else {
      for (const t of tokens) this._subscribedTokens.add(t); // queue until connected
    }

    return () => { this._subs.delete(onTick); };
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

  async listSymbols() {
    // In production: cache the instruments master dump (refreshed at 6am IST).
    // For the scaffold: return what we currently have LTPs for.
    return Array.from(this._lastLtp.keys());
  }

  health() {
    return {
      name: this.name,
      connected: this._connected,
      subscribers: this._subs.size,
      subscribedInstruments: this._subscribedTokens.size,
      reconnectAttempts: this._reconnectAttempts,
      lastTickAt: this._lastTickAt,
      lagMs: this._lastTickAt ? Date.now() - this._lastTickAt : null,
    };
  }
}

module.exports = { ZerodhaBroker };

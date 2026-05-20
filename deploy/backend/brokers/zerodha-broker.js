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

    /** T99-T34: stale-token detection — when the daily access_token expires the
        Kite WS endpoint replies 403 to every reconnect. If we let autoReconnect
        keep firing for 20 attempts we spam Kite + fill our logs with the same
        line 60+ times. Track consecutive 403s and pause the ticker once we're
        sure the token is dead; the next setAccessToken() resumes it. */
    this._consecutive403s = 0;
    this._stalledOnToken = false;

    /** T99-T37: heartbeat / tick-stale detection. The WS may stay 'connected'
        while Kite stops sending ticks (server hiccup, NATs eating frames).
        Without this check the UI shows 'streaming' while prices are frozen.
        We sample _lastTickAt every 30s; if market is open + we're connected +
        no tick has arrived for HEARTBEAT_STALE_MS, flip _tickStale=true. */
    this._tickStale = false;
    this._heartbeatTimer = null;
    /** T99-T55: timestamp of the last successful setAccessToken() call.
        Lets operators tell whether the morning cron actually refreshed the
        global broker today — answers 'is brokerWsStalled because the cron
        failed, or because something else is wrong'. */
    this._lastAccessTokenSetAt = 0;

    /** T99-T115: reactive reauth hook. When _stalledOnToken flips true,
        we call _onStall (if set) so the cron-reauth runner can attempt
        an immediate reauth instead of waiting for the next 05:45 IST
        cycle. Set via setOnStall() from server.js after cron-reauth is
        created. We also track the last-trigger timestamp to rate-limit
        (at most once per 15 min, max 3 per rolling 24h). */
    this._onStall = null;
    this._stallTriggerHistory = []; // array of Date.now() values
  }

  /** T99-T115: set the reactive-reauth callback. Called when the broker
      detects 3 consecutive 403s and pauses the ticker. The callback
      receives a reason string and returns a promise (we don't await it
      from the error handler — fire-and-forget). */
  setOnStall(fn) { this._onStall = typeof fn === 'function' ? fn : null; }

  /** T99-T115: rate-limit gate. Returns true if we should fire the
      onStall callback right now. Limits: at most once per 15 min,
      and at most 3 fires in any rolling 24h. */
  _canFireStallTrigger() {
    const now = Date.now();
    // Prune entries older than 24h.
    this._stallTriggerHistory = this._stallTriggerHistory.filter(t => now - t < 24 * 60 * 60 * 1000);
    if (this._stallTriggerHistory.length >= 3) return false;
    const last = this._stallTriggerHistory[this._stallTriggerHistory.length - 1];
    if (last && (now - last) < 15 * 60 * 1000) return false;
    return true;
  }
  _recordStallTrigger() { this._stallTriggerHistory.push(Date.now()); }

  // 9:15–15:30 IST on weekdays. We deliberately ignore holidays for the
  // heartbeat — on a holiday the WS won't be sending ticks anyway and the
  // false-positive cost is zero (just a UI flag that resolves itself on the
  // next trading day). The opposite mistake (suppressing the heartbeat on a
  // day that's actually trading) is much worse.
  _isMarketOpen(now = new Date()) {
    // Convert to IST. IST = UTC+5:30, no DST. Use the offset directly so this
    // works regardless of the server's TZ.
    const istMs = now.getTime() + (5 * 60 + 30) * 60 * 1000;
    const ist = new Date(istMs);
    const dow = ist.getUTCDay(); // 0 = Sunday
    if (dow === 0 || dow === 6) return false;
    const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();
    return mins >= (9 * 60 + 15) && mins <= (15 * 60 + 30);
  }

  _startHeartbeat() {
    if (this._heartbeatTimer) return;
    const HEARTBEAT_CHECK_MS = 30_000;
    const HEARTBEAT_STALE_MS = 90_000;
    this._heartbeatTimer = setInterval(() => {
      try {
        if (!this._connected || this._stalledOnToken) {
          // Not connected at all — the ws-stalled/disconnected indicators
          // already cover this case; don't double-flag.
          if (this._tickStale) this._tickStale = false;
          return;
        }
        if (!this._isMarketOpen()) {
          if (this._tickStale) this._tickStale = false;
          return;
        }
        const lag = this._lastTickAt ? Date.now() - this._lastTickAt : Infinity;
        const stale = lag > HEARTBEAT_STALE_MS;
        if (stale !== this._tickStale) {
          this._tickStale = stale;
          if (stale) {
            console.warn(`[zerodha] tick heartbeat STALE — no ticks for ${Math.round(lag/1000)}s while market open`);
          } else {
            console.log('[zerodha] tick heartbeat recovered');
          }
        }
      } catch (e) {
        // Heartbeat must never throw — it would cancel its own interval.
        console.warn('[zerodha] heartbeat check error:', e && e.message);
      }
    }, HEARTBEAT_CHECK_MS);
    // Don't keep the event loop alive for this alone.
    if (this._heartbeatTimer.unref) this._heartbeatTimer.unref();
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
    this._lastAccessTokenSetAt = Date.now();

    // T99-T34: a fresh token clears the stale-token stall. Reset counters and
    // give the ticker an immediate connect attempt instead of waiting for the
    // next subscribe call. If the ticker was never created (first auth) this
    // is a no-op — the start() call below handles that path.
    if (this._stalledOnToken) {
      console.log('[zerodha] fresh token sealed — resuming ticker from stalled state');
      this._stalledOnToken = false;
      this._consecutive403s = 0;
      if (this.ticker) {
        try { this.ticker.connect(); } catch (e) {
          console.warn('[zerodha] ticker resume failed:', e && e.message);
        }
      }
    } else {
      this._consecutive403s = 0;
    }

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

    // Configure KiteTicker's built-in reconnect: bounded retries, max 60s between attempts.
    // Prevents the runaway reconnect storm that gets us rate-limited by Kite (see Task #60).
    // Library API: autoReconnect(enable, max_retry=50, max_delay=60).
    try {
      if (typeof this.ticker.autoReconnect === 'function') {
        this.ticker.autoReconnect(true, 20, 60);
      }
    } catch (e) {
      console.warn('[zerodha] autoReconnect config failed:', e && e.message);
    }

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
      // Log every 5 attempts so it's visible in audit/journald.
      if (attempts > 0 && attempts % 5 === 0) {
        console.warn(`[zerodha] ticker reconnect attempt ${attempts}`);
      }
    });

    // When KiteTicker gives up after max retries it emits 'noreconnect'.
    // Surface this clearly; subsequent setAccessToken() will reset.
    this.ticker.on('noreconnect', () => {
      console.error('[zerodha] ticker exhausted reconnect attempts; standing down to avoid Kite rate-limit. Run auto-login to refresh.');
      this._connected = false;
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
      const msg = (err && err.message) || String(err || '');
      // T99-T34: collapse the 403 storm. Three consecutive 403s = dead token,
      // not a transient blip — kill autoReconnect until a fresh token arrives.
      if (/\b403\b/.test(msg)) {
        this._consecutive403s++;
        if (this._consecutive403s >= 3 && !this._stalledOnToken) {
          this._stalledOnToken = true;
          this._connected = false;
          console.error('[zerodha] stale access_token (3x HTTP 403 from Kite WS) — pausing ticker until next auto-reauth or manual reconnect');
          try {
            if (typeof this.ticker.autoReconnect === 'function') this.ticker.autoReconnect(false, 0, 60);
            this.ticker.disconnect();
          } catch (_e) { /* ignore */ }
          // T99-T115: fire reactive reauth trigger (rate-limited). The
          // callback (set from server.js after cron-reauth is created)
          // runs the same daemon→exchange→setAccessToken chain that the
          // 05:45 IST scheduler uses. If it succeeds, _stalledOnToken
          // flips false again inside setAccessToken().
          if (this._onStall && this._canFireStallTrigger()) {
            this._recordStallTrigger();
            console.log('[zerodha] firing reactive reauth trigger (stall recovery)');
            Promise.resolve(this._onStall('3x_403_stall')).catch(e => console.error('[zerodha] onStall error:', e && e.message));
          } else if (this._onStall) {
            console.log('[zerodha] stall detected but reactive trigger rate-limited');
          }
          return;
        }
        // Only log first two 403s loudly; suppress the rest until we trip the gate.
        if (this._consecutive403s <= 2) {
          console.error('[zerodha] ticker error:', msg);
        }
        return;
      }
      // Any non-403 resets the counter.
      this._consecutive403s = 0;
      console.error('[zerodha] ticker error:', msg);
    });

    this.ticker.connect();
    this._startHeartbeat();
  }

  async stop() {
    if (this.ticker) {
      try { this.ticker.disconnect(); } catch (e) { console.debug('[zerodha-broker] swallowed:', e && e.message); }
      this.ticker = null;
    }
    if (this._heartbeatTimer) {
      clearInterval(this._heartbeatTimer);
      this._heartbeatTimer = null;
    }
    this._subs.clear();
    this._subscribedTokens.clear();
    this._connected = false;
    this._tickStale = false;
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

  /** Available option expiries for an underlying. */
  listOptionExpiries(underlying) {
    if (!underlying) return [];
    return this.instruments.listExpiries(String(underlying).toUpperCase());
  }

  /**
   * Full option chain (all strikes, CE+PE pairs) for an underlying+expiry.
   * Does NOT include LTPs/OI — caller chains to /api/quotes for those.
   * @returns {{underlying, expiry, strikes:Array<{strike,ce,pe}>, count, lotSize}}
   */
  getOptionChain(underlying, expiry) {
    if (!underlying || !expiry) throw new Error('underlying and expiry required');
    const strikes = this.instruments.optionsFor(String(underlying).toUpperCase(), expiry);
    const lotSize = strikes.length && strikes[0].ce ? strikes[0].ce.lotSize : (strikes[0] && strikes[0].pe ? strikes[0].pe.lotSize : 0);
    return { underlying, expiry, strikes, count: strikes.length, lotSize };
  }

  /** Get full metadata for a symbol (lot, segment, expiry, strike, etc.) */
  symbolMeta(symbol) {
    const tok = this.instruments.tokenOf(symbol);
    if (!tok) return null;
    return this.instruments.metaFor(tok);
  }

  /** Snapshot of the in-memory tick cache. Includes indices that /quotes can't return. */
  getLastTicks() {
    const out = [];
    for (const [symbol, ltp] of this._lastLtp) {
      out.push({ symbol, ltp, ts: this._lastTickAt });
    }
    return out;
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

  /**
   * Place a real order via Kite Connect.
   *
   * SAFETY: this method exists but is ONLY called by server.js when KILL_SWITCH=false
   * AND the explicit env LIVE_TRADING=true is set. server.js gates this on every call.
   *
   * Payload comes pre-validated by server.js /api/orders/place handler:
   *   { strategyTag, symbol, exchange, side, quantity, product, orderType,
   *     variety, validity, price?, triggerPrice?, clientOrderId }
   *
   * Returns: { orderId, status, raw } -- broker-issued order id + status snapshot.
   * Throws: any kiteconnect error (auth, margin, circuit, etc.) -- caller catches.
   */
  async placeOrder(payload) {
    if (!this.accessToken) throw new Error('not authenticated');
    if (!payload || !payload.symbol) throw new Error('symbol required');

    // Resolve to Kite trading symbol + exchange. We accept either:
    //   - { exchange:"NSE", symbol:"RELIANCE" }
    //   - { symbol:"NSE:RELIANCE" }  (compound form)
    let exchange = (payload.exchange || 'NSE').toUpperCase();
    let tradingsymbol = String(payload.symbol).trim();
    if (tradingsymbol.includes(':')) {
      const [ex, sym] = tradingsymbol.split(':');
      exchange = ex.toUpperCase();
      tradingsymbol = sym;
    }

    // Kite expects lowercase variety strings; everything else uppercase.
    const variety = (payload.variety || 'regular').toLowerCase();
    const kiteParams = {
      tradingsymbol,
      exchange,
      transaction_type: payload.side,
      quantity: payload.quantity,
      product: payload.product,
      order_type: payload.orderType,
      validity: payload.validity || 'DAY',
      tag: (payload.strategyTag || 'ats').slice(0, 20),
    };
    if (payload.orderType === 'LIMIT' && payload.price != null) {
      kiteParams.price = payload.price;
    }
    if ((payload.orderType === 'SL' || payload.orderType === 'SL-M') && payload.triggerPrice != null) {
      kiteParams.trigger_price = payload.triggerPrice;
    }

    // kiteconnect returns { order_id: "..." }
    const result = await this.kc.placeOrder(variety, kiteParams);
    return {
      orderId: result.order_id,
      status: 'submitted',
      variety,
      params: kiteParams,
      raw: result,
    };
  }

  /**
   * Cancel a working order by Kite order id. Variety must match the original placement.
   */
  async cancelOrder({ orderId, variety }) {
    if (!this.accessToken) throw new Error('not authenticated');
    if (!orderId) throw new Error('orderId required');
    const v = (variety || 'regular').toLowerCase();
    const result = await this.kc.cancelOrder(v, orderId);
    return { orderId: result.order_id || orderId, status: 'cancelled', raw: result };
  }

  /** Health snapshot for /api/health */
  // -------------------------------------------------------------------------
  // T-240: Mutual Fund read-side. Kite Connect MF API is GET-only — placement
  // requires bank-account payment via Coin, not exposed over the API. The
  // 4 methods below are kc.getMFHoldings/getMFSIPs/getMFOrders/getMFInstruments
  // each remapped to camelCase shape the frontend already uses for equities.
  //
  // Field-name reference: https://kite.trade/docs/connect/v3/mutual-funds/
  // -------------------------------------------------------------------------

  /** Mutual-fund holdings (Coin-routed only). Folio + ISIN + units + NAV. */
  async getMFHoldings() {
    if (!this.accessToken) throw new Error('not authenticated');
    const rows = await this.kc.getMFHoldings();
    return (rows || []).map((h) => ({
      folio:         h.folio,
      fund:          h.fund,
      isin:          h.tradingsymbol,        // ISIN is the trading symbol for MFs
      quantity:      h.quantity,
      avgPrice:      h.average_price,
      nav:           h.last_price,
      navDate:       h.last_price_date,
      pnl:           h.pnl,
      pledgedQty:    h.pledged_quantity,
    }));
  }

  /** Active + paused SIPs registered via Coin. */
  async getMFSIPs() {
    if (!this.accessToken) throw new Error('not authenticated');
    const rows = await this.kc.getMFSIPS();   // SDK uses uppercase plural
    return (rows || []).map((s) => ({
      sipId:                 s.sip_id,
      sipRegNum:             s.sip_reg_num,
      isin:                  s.tradingsymbol,
      fund:                  s.fund,
      sipType:               s.sip_type,           // 'sip' or 'amc_sip'
      transactionType:       s.transaction_type,
      status:                s.status,             // ACTIVE / PAUSED / CANCELLED
      frequency:             s.frequency,          // weekly / monthly / quarterly
      instalmentAmount:      s.instalment_amount,
      instalmentDay:         s.instalment_day,
      nextInstalment:        s.next_instalment,
      lastInstalment:        s.last_instalment,
      completedInstalments:  s.completed_instalments,
      pendingInstalments:    s.pending_instalments,
      totalInstalments:      s.instalments,
      dividendType:          s.dividend_type,
      triggerPrice:          s.trigger_price,
      stepUp:                s.step_up,
      tag:                   s.tag,
      created:               s.created,
    }));
  }

  /** MF orders placed in the last 7 days. */
  async getMFOrders() {
    if (!this.accessToken) throw new Error('not authenticated');
    const rows = await this.kc.getMFOrders();
    return (rows || []).map((o) => ({
      orderId:           o.order_id,
      exchangeOrderId:   o.exchange_order_id,
      status:            o.status,                 // OPEN / COMPLETE / REJECTED / CANCELLED
      statusMessage:     o.status_message,
      isin:              o.tradingsymbol,
      fund:              o.fund,
      folio:             o.folio,
      settlementId:      o.settlement_id,
      transactionType:   o.transaction_type,       // BUY / SELL
      amount:            o.amount,
      quantity:          o.quantity,
      price:             o.price,
      nav:               o.last_price,
      navDate:           o.last_price_date,
      avgPrice:          o.average_price,
      variety:           o.variety,                // regular / sip / amc_sip
      purchaseType:      o.purchase_type,          // FRESH / ADDITIONAL
      orderTimestamp:    o.order_timestamp,
      exchangeTimestamp: o.exchange_timestamp,
      tag:               o.tag,
      placedBy:          o.placed_by,
    }));
  }

  /** Full Coin scheme master. ~16k+ rows. Cache locally for 24h to avoid hammering. */
  async getMFInstruments() {
    if (!this.accessToken) throw new Error('not authenticated');
    // kiteconnect v5 returns parsed CSV as Array<object> with snake_case columns.
    const rows = await this.kc.getMFInstruments();
    return (rows || []).map((r) => ({
      isin:                          r.tradingsymbol,
      amc:                           r.amc,
      name:                          r.name,
      purchaseAllowed:               String(r.purchase_allowed) === '1',
      redemptionAllowed:             String(r.redemption_allowed) === '1',
      minPurchase:                   Number(r.minimum_purchase_amount) || 0,
      purchaseMultiplier:            Number(r.purchase_amount_multiplier) || 1,
      minAdditionalPurchase:         Number(r.minimum_additional_purchase_amount) || 0,
      minRedemption:                 Number(r.minimum_redemption_quantity) || 0,
      redemptionMultiplier:          Number(r.redemption_quantity_multiplier) || 0.001,
      dividendType:                  r.dividend_type,
      schemeType:                    r.scheme_type,
      plan:                          r.plan,                  // direct / regular
      settlementType:                r.settlement_type,       // T1 / T2 / T3 ...
      nav:                           Number(r.last_price) || 0,
      navDate:                       r.last_price_date,
    }));
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
      hasAccessToken: !!this.accessToken,
      tickerInitialized: !!this.ticker,
      // T99-T42: mirror the T-34/T-37 signals so /api/health, /api/preflight,
      // and the dashboard can distinguish 'live and streaming' from 'connected
      // but stalled/frozen'. Critical for paper-trade order placement which
      // uses last LTP from the ticker — if tickStale or stalledOnToken is
      // true, the LTP is stale and orders should be rejected, not filled.
      stalledOnToken: this._stalledOnToken === true,
      tickStale: this._tickStale === true,
      // T99-T55: when was setAccessToken last called? Operators read this to
      // tell whether today's morning cron fired (= recent timestamp) or not
      // (= timestamp from yesterday or container-start time).
      lastAccessTokenSetAt: this._lastAccessTokenSetAt || 0,
      accessTokenAgeMs: this._lastAccessTokenSetAt ? Date.now() - this._lastAccessTokenSetAt : null,
      instruments: this.instruments.stats(),
    };
  }
}

module.exports = { ZerodhaBroker };

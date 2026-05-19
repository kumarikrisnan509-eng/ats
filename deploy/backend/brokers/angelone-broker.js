// angelone-broker.js -- Tier 44: AngelOne SmartAPI v1 LIVE adapter (production-grade, untested).
//
// SmartAPI: https://smartapi.angelbroking.com/docs
// REST base: https://apiconnect.angelbroking.com
// Auth: /auth/loginByPassword (clientcode + password + TOTP) -> { jwtToken, refreshToken, feedToken }.
// WS: wss://smartapisocket.angelbroking.com/smart-stream for ticks.
//
// Untested against a real Angel account. Smoke-test each method on paper
// before flipping BROKER=angelone.

'use strict';

const https = require('https');
const otplib = (() => { try { return require('otplib'); } catch (_) { return null; } })();
const WebSocket = (() => { try { return require('ws'); } catch (_) { return null; } })();

const BASE = 'https://apiconnect.angelbroking.com';
const WS_FEED = 'wss://smartapisocket.angelbroking.com/smart-stream';

function httpJson({ method, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const data = body != null ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'X-UserType': 'USER',
        'X-SourceID': 'WEB',
        'X-ClientLocalIP': '127.0.0.1',
        'X-ClientPublicIP': '127.0.0.1',
        'X-MACAddress': '00:00:00:00:00:00',
        'X-PrivateKey': headers['X-PrivateKey'] || '',
        ...(headers.Authorization ? { 'Authorization': headers.Authorization } : {}),
        ...(data ? { 'Content-Length': Buffer.byteLength(data) } : {}),
      },
      timeout: 15000,
    }, (res) => {
      let b = '';
      res.on('data', (c) => { b += c; });
      res.on('end', () => {
        let parsed;
        try { parsed = b ? JSON.parse(b) : null; } catch (_) { parsed = b; }
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(parsed);
        else reject(new Error('angelone ' + method + ' ' + path + ': HTTP ' + res.statusCode + ' ' + (typeof parsed === 'string' ? parsed : JSON.stringify(parsed))));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('angelone timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

class AngelOneBroker {
  constructor({ apiKey, clientCode, password, totpSeed } = {}) {
    this.name = 'angelone';
    this.apiKey     = apiKey     || process.env.ANGEL_API_KEY    || '';
    this.clientCode = clientCode || process.env.ANGEL_CLIENT_ID  || '';
    this.password   = password   || process.env.ANGEL_PASSWORD   || '';
    this.totpSeed   = totpSeed   || process.env.ANGEL_TOTP_SEED  || '';
    this.jwtToken     = '';
    this.refreshToken = '';
    this.feedToken    = '';
    this._tickSubscribers = new Set();
    this._lastTicks = new Map();
    this._connected = false;
    this._subscribedInstruments = new Set();
    this._ws = null;
    this._lastTickAt = 0;
    this._reconnectAttempts = 0;
    this._instruments = new Map();
    this._symbolToToken = new Map();
  }

  setAccessToken(t) { this.jwtToken = t || ''; this._connected = !!this.jwtToken; }
  _headers() { return { 'X-PrivateKey': this.apiKey, Authorization: this.jwtToken ? ('Bearer ' + this.jwtToken) : '' }; }

  _requireCreds() {
    if (!this.apiKey)     throw new Error('angelone: missing ANGEL_API_KEY');
    if (!this.clientCode) throw new Error('angelone: missing ANGEL_CLIENT_ID');
    if (!this.password)   throw new Error('angelone: missing ANGEL_PASSWORD');
    if (!this.totpSeed)   throw new Error('angelone: missing ANGEL_TOTP_SEED');
  }
  _requireToken() {
    if (!this.jwtToken) throw new Error('angelone: not logged in. Call start() first.');
  }

  async start() {
    try { this._requireCreds(); }
    catch (e) { console.log('[angelone] start() deferred:', e.message); return; }
    try { await this.login(); console.log('[angelone] logged in'); this._connected = true; }
    catch (e) { console.error('[angelone] login failed:', e.message); }
  }
  async stop() {
    try { if (this._ws) this._ws.close(); } catch (e) { console.debug('[angelone-broker] swallowed:', e && e.message); }
    this._ws = null;
    this._connected = false;
  }

  async login() {
    this._requireCreds();
    if (!otplib) throw new Error('angelone: otplib not installed (npm i otplib)');
    const totp = otplib.authenticator.generate(this.totpSeed);
    const body = { clientcode: this.clientCode, password: this.password, totp };
    const r = await httpJson({
      method: 'POST',
      path: '/rest/auth/angelbroking/user/v1/loginByPassword',
      headers: { 'X-PrivateKey': this.apiKey },
      body,
    });
    if (!r || !r.data || !r.data.jwtToken) throw new Error('angelone: login response missing jwtToken');
    this.jwtToken     = r.data.jwtToken;
    this.refreshToken = r.data.refreshToken;
    this.feedToken    = r.data.feedToken;
    return { jwtToken: this.jwtToken, feedToken: this.feedToken };
  }

  health() {
    return {
      name: this.name,
      connected: this._connected,
      subscribers: this._tickSubscribers.size,
      subscribedInstruments: this._subscribedInstruments.size,
      reconnectAttempts: this._reconnectAttempts,
      lastTickAt: this._lastTickAt,
      hasAccessToken: !!this.jwtToken,
      tickerInitialized: !!this._ws,
      instruments: { size: this._instruments.size },
    };
  }

  async getProfile() {
    this._requireToken();
    const r = await httpJson({ method: 'GET', path: '/rest/secure/angelbroking/user/v1/getProfile', headers: this._headers() });
    return (r && r.data) || r;
  }
  async getHoldings() {
    this._requireToken();
    const r = await httpJson({ method: 'GET', path: '/rest/secure/angelbroking/portfolio/v1/getHolding', headers: this._headers() });
    const list = (r && r.data) || [];
    return list.map(h => ({
      tradingsymbol: h.tradingsymbol,
      exchange:      h.exchange || 'NSE',
      isin:          h.isin,
      quantity:      Number(h.quantity || 0),
      avgPrice:      Number(h.averageprice || 0),
      lastPrice:     Number(h.ltp || h.close || 0),
      ltp:           Number(h.ltp || 0),
      productType:   h.product || 'CNC',
    }));
  }
  async getOrders() {
    this._requireToken();
    const r = await httpJson({ method: 'GET', path: '/rest/secure/angelbroking/order/v1/getOrderBook', headers: this._headers() });
    return (r && r.data) || [];
  }
  async getPositions() {
    this._requireToken();
    const r = await httpJson({ method: 'GET', path: '/rest/secure/angelbroking/order/v1/getPosition', headers: this._headers() });
    const list = (r && r.data) || [];
    return { net: list, day: list };
  }
  async getMargins() {
    this._requireToken();
    const r = await httpJson({ method: 'GET', path: '/rest/secure/angelbroking/user/v1/getRMS', headers: this._headers() });
    return { equity: { available: { cash: Number((r && r.data && r.data.availablecash) || 0) }, raw: r && r.data } };
  }
  async getHistorical({ symbol, interval, from, to, instrumentToken }) {
    this._requireToken();
    const symboltoken = instrumentToken || this._symbolToToken.get(symbol);
    if (!symboltoken) throw new Error('angelone: unknown symboltoken for ' + symbol);
    const body = {
      exchange: 'NSE',
      symboltoken: String(symboltoken),
      interval: this._normalizeInterval(interval),
      fromdate: from + ' 09:15',
      todate:   to   + ' 15:30',
    };
    const r = await httpJson({ method: 'POST', path: '/rest/secure/angelbroking/historical/v1/getCandleData', headers: this._headers(), body });
    const rows = (r && r.data) || [];
    return rows.map(row => ({
      date: row[0], open: row[1], high: row[2], low: row[3], close: row[4], volume: row[5],
    }));
  }
  _normalizeInterval(k) {
    return ({ 'day':'ONE_DAY','60minute':'ONE_HOUR','15minute':'FIFTEEN_MINUTE','5minute':'FIVE_MINUTE','minute':'ONE_MINUTE' })[k] || 'ONE_DAY';
  }

  async placeOrder(p) {
    this._requireToken();
    const symboltoken = this._symbolToToken.get(p.symbol);
    if (!symboltoken) throw new Error('angelone: unknown symboltoken for ' + p.symbol);
    const body = {
      variety:        (p.variety || 'NORMAL').toUpperCase(),
      tradingsymbol:  p.symbol,
      symboltoken:    String(symboltoken),
      transactiontype:p.side,
      exchange:       p.exchange || 'NSE',
      ordertype:      p.orderType,
      producttype:    p.product,
      duration:       (p.validity || 'DAY').toUpperCase(),
      price:          p.price != null ? Number(p.price) : 0,
      triggerprice:   p.triggerPrice != null ? Number(p.triggerPrice) : 0,
      quantity:       Number(p.quantity),
      algoid:         p.algoId,
      tag:            (p.clientOrderId || '').slice(0, 20),
    };
    const r = await httpJson({ method: 'POST', path: '/rest/secure/angelbroking/order/v1/placeOrder', headers: this._headers(), body });
    return { orderId: r && r.data && r.data.orderid, status: r && r.message, raw: r };
  }
  async cancelOrder({ orderId, variety }) {
    this._requireToken();
    if (!orderId) throw new Error('angelone: orderId required');
    const body = { variety: (variety || 'NORMAL').toUpperCase(), orderid: orderId };
    const r = await httpJson({ method: 'POST', path: '/rest/secure/angelbroking/order/v1/cancelOrder', headers: this._headers(), body });
    return { ok: true, raw: r };
  }

  async subscribeTicks(symbols, onTick) {
    this._requireToken();
    if (!WebSocket) throw new Error('angelone: ws not installed');
    if (typeof onTick === 'function') this._tickSubscribers.add(onTick);
    const tokens = (symbols || []).map(s => this._symbolToToken.get(s)).filter(Boolean);
    if (!this._ws) {
      this._ws = new WebSocket(WS_FEED, {
        headers: {
          'Authorization': 'Bearer ' + this.jwtToken,
          'x-api-key':     this.apiKey,
          'x-client-code': this.clientCode,
          'x-feed-token':  this.feedToken,
        },
      });
      this._ws.on('open',    () => { this._reconnectAttempts = 0; this._sendSubscribe(tokens); });
      this._ws.on('message', (d) => this._handleTick(d));
      this._ws.on('close',   () => { this._ws = null; setTimeout(() => this.subscribeTicks(symbols, onTick), Math.min(30000, 1000 * (++this._reconnectAttempts))); });
      this._ws.on('error',   (e) => console.error('[angelone ws]', e.message));
    } else {
      this._sendSubscribe(tokens);
    }
    for (const t of tokens) this._subscribedInstruments.add(t);
    return { added: tokens, total: this._subscribedInstruments.size };
  }
  _sendSubscribe(tokens) {
    if (!this._ws || this._ws.readyState !== 1) return;
    const msg = {
      correlationID: 'ats-' + Date.now(),
      action: 1,
      params: { mode: 2, tokenList: [{ exchangeType: 1, tokens: tokens.map(String) }] },
    };
    this._ws.send(JSON.stringify(msg));
  }
  _handleTick(data) {
    this._lastTickAt = Date.now();
    let tick;
    try {
      if (Buffer.isBuffer(data) && data.length >= 51) {
        const token = data.readInt32LE(3);
        const ltpx100 = Number(data.readBigInt64LE(43));
        tick = { instrument_token: token, last_price: ltpx100 / 100, ts: this._lastTickAt };
      } else if (typeof data === 'string') {
        const j = JSON.parse(data);
        if (j && j.tk) tick = { instrument_token: Number(j.tk), last_price: Number(j.lp || 0) / 100, ts: this._lastTickAt };
      }
    } catch (e) { console.warn('[angelone-broker] swallowed:', e && e.message); }
    if (!tick) return;
    this._lastTicks.set(tick.instrument_token, tick);
    for (const sub of this._tickSubscribers) { try { sub(tick); } catch (e) { console.warn('[angelone-broker] swallowed:', e && e.message); } }
  }
  async ensureSubscribed(symbols) {
    const tokens = (symbols || []).map(s => this._symbolToToken.get(s)).filter(Boolean);
    const added = tokens.filter(t => !this._subscribedInstruments.has(t));
    if (added.length > 0 && this._ws) this._sendSubscribe(tokens);
    for (const t of added) this._subscribedInstruments.add(t);
    return { added, total: this._subscribedInstruments.size };
  }

  async loadInstrumentMaster(rows) {
    this._instruments.clear();
    this._symbolToToken.clear();
    for (const r of rows || []) {
      const tok = r.token || r.symboltoken;
      const sym = r.symbol || r.tradingsymbol || r.name;
      if (!tok || !sym) continue;
      this._instruments.set(tok, { symbol: sym, segment: r.exch_seg, lotSize: Number(r.lotsize || 1) });
      this._symbolToToken.set(sym, tok);
    }
    return { count: this._instruments.size };
  }
}

module.exports = { AngelOneBroker };

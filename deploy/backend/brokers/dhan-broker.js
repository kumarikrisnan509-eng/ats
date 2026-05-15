// dhan-broker.js -- Tier 44: DhanHQ v2 LIVE adapter (production-grade, untested against real account).
//
// DhanHQ API: https://dhanhq.co/docs/v2/
// REST base:  https://api.dhan.co/v2
// Auth: long-lived API token + client-id headers (no daily refresh).
// WS:   wss://api-feed.dhan.co for ticks (mixed JSON/binary).
//
// IMPORTANT: written against Dhan's public v2 docs but NOT run against a live
// Dhan API token. Smoke-test each endpoint on a paper account before flipping
// BROKER=dhan in prod.

'use strict';

const https = require('https');
const WebSocket = (() => { try { return require('ws'); } catch (_) { return null; } })();

const BASE = 'https://api.dhan.co/v2';
const WS_FEED = 'wss://api-feed.dhan.co';

function httpJson({ method, path, headers, body }) {
  return new Promise((resolve, reject) => {
    const u = new URL(BASE + path);
    const data = body != null ? JSON.stringify(body) : null;
    const req = https.request({
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      headers: {
        'access-token': headers['access-token'] || '',
        'client-id':    headers['client-id'] || '',
        'Content-Type': 'application/json',
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
        else reject(new Error('dhan ' + method + ' ' + path + ': HTTP ' + res.statusCode + ' ' + (typeof parsed === 'string' ? parsed : JSON.stringify(parsed))));
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('dhan timeout')); });
    if (data) req.write(data);
    req.end();
  });
}

class DhanBroker {
  constructor({ accessToken, clientId } = {}) {
    this.name = 'dhan';
    this.accessToken = accessToken || process.env.DHAN_ACCESS_TOKEN || '';
    this.clientId    = clientId    || process.env.DHAN_CLIENT_ID    || '';
    this._tickSubscribers = new Set();
    this._lastTicks = new Map();
    this._connected = false;
    this._subscribedInstruments = new Set();
    this._ws = null;
    this._lastTickAt = 0;
    this._reconnectAttempts = 0;
    this._instruments = new Map();
    this._symbolToSecurityId = new Map();
  }

  setAccessToken(t) { this.accessToken = t || ''; this._connected = !!this.accessToken; }
  _headers() { return { 'access-token': this.accessToken, 'client-id': this.clientId }; }
  _requireToken() {
    if (!this.accessToken) throw new Error('dhan: no access token. Set DHAN_ACCESS_TOKEN env.');
    if (!this.clientId)    throw new Error('dhan: no client id. Set DHAN_CLIENT_ID env.');
  }

  async start() {
    if (!this.accessToken || !this.clientId) {
      console.log('[dhan] start() deferred: no access token / client id yet');
      return;
    }
    try { await this.getProfile(); this._connected = true; console.log('[dhan] REST OK'); }
    catch (e) { console.error('[dhan] REST probe failed:', e.message); }
  }
  async stop() {
    try { if (this._ws) this._ws.close(); } catch (_) {}
    this._ws = null;
    this._connected = false;
  }

  health() {
    return {
      name: this.name,
      connected: this._connected,
      subscribers: this._tickSubscribers.size,
      subscribedInstruments: this._subscribedInstruments.size,
      reconnectAttempts: this._reconnectAttempts,
      lastTickAt: this._lastTickAt,
      hasAccessToken: !!this.accessToken,
      tickerInitialized: !!this._ws,
      instruments: { size: this._instruments.size },
    };
  }

  async getProfile() {
    this._requireToken();
    return await httpJson({ method: 'GET', path: '/users/profile', headers: this._headers() });
  }
  async getHoldings() {
    this._requireToken();
    const r = await httpJson({ method: 'GET', path: '/holdings', headers: this._headers() });
    return (Array.isArray(r) ? r : (r && r.data) || []).map(h => ({
      tradingsymbol: h.tradingSymbol || h.symbol,
      exchange:      h.exchange || 'NSE',
      isin:          h.isin,
      quantity:      Number(h.totalQty || h.availableQty || 0),
      avgPrice:      Number(h.avgCostPrice || 0),
      lastPrice:     Number(h.lastTradedPrice || 0),
      ltp:           Number(h.lastTradedPrice || 0),
      productType:   h.productType || 'CNC',
    }));
  }
  async getOrders() {
    this._requireToken();
    const r = await httpJson({ method: 'GET', path: '/orders', headers: this._headers() });
    return Array.isArray(r) ? r : (r && r.data) || [];
  }
  async getPositions() {
    this._requireToken();
    const r = await httpJson({ method: 'GET', path: '/positions', headers: this._headers() });
    const list = Array.isArray(r) ? r : (r && r.data) || [];
    return { net: list, day: list };
  }
  async getMargins() {
    this._requireToken();
    const r = await httpJson({ method: 'GET', path: '/fundlimit', headers: this._headers() });
    return { equity: { available: { cash: Number((r && (r.availabelBalance || r.availableBalance)) || 0) }, raw: r } };
  }
  async getHistorical({ symbol, interval, from, to, instrumentToken }) {
    this._requireToken();
    const securityId = instrumentToken || this._symbolToSecurityId.get(symbol);
    if (!securityId) throw new Error('dhan: unknown securityId for symbol ' + symbol);
    const body = {
      securityId: String(securityId),
      exchangeSegment: 'NSE_EQ',
      instrument: 'EQUITY',
      interval: this._normalizeInterval(interval),
      fromDate: from, toDate: to,
    };
    const r = await httpJson({ method: 'POST', path: '/charts/historical', headers: this._headers(), body });
    const out = [];
    const n = r && r.open ? r.open.length : 0;
    for (let i = 0; i < n; i++) {
      out.push({
        date: new Date(r.timestamp[i] * 1000).toISOString(),
        open: r.open[i], high: r.high[i], low: r.low[i], close: r.close[i],
        volume: r.volume[i],
      });
    }
    return out;
  }
  _normalizeInterval(k) {
    return ({ 'day':'1day','60minute':'60m','15minute':'15m','5minute':'5m','minute':'1m' })[k] || '1day';
  }

  async placeOrder(p) {
    this._requireToken();
    const securityId = this._symbolToSecurityId.get(p.symbol);
    if (!securityId) throw new Error('dhan: unknown securityId for ' + p.symbol);
    const body = {
      transactionType: p.side,
      exchangeSegment: 'NSE_EQ',
      productType:     p.product,
      orderType:       p.orderType,
      validity:        p.validity || 'DAY',
      securityId:      String(securityId),
      quantity:        Number(p.quantity),
      price:           p.price != null ? Number(p.price) : 0,
      triggerPrice:    p.triggerPrice != null ? Number(p.triggerPrice) : 0,
      correlationId:   p.clientOrderId,
      algoId:          p.algoId,
    };
    const r = await httpJson({ method: 'POST', path: '/orders', headers: this._headers(), body });
    return { orderId: r && r.orderId, status: r && r.orderStatus, raw: r };
  }
  async cancelOrder({ orderId }) {
    this._requireToken();
    if (!orderId) throw new Error('dhan: orderId required');
    const r = await httpJson({ method: 'DELETE', path: '/orders/' + orderId, headers: this._headers() });
    return { ok: true, raw: r };
  }

  async subscribeTicks(symbols, onTick) {
    this._requireToken();
    if (!WebSocket) throw new Error('dhan: ws module not installed');
    if (typeof onTick === 'function') this._tickSubscribers.add(onTick);
    const securityIds = (symbols || []).map(s => this._symbolToSecurityId.get(s)).filter(Boolean);
    if (!this._ws) {
      const wsUrl = WS_FEED + '?token=' + encodeURIComponent(this.accessToken) + '&clientId=' + encodeURIComponent(this.clientId) + '&authType=2';
      this._ws = new WebSocket(wsUrl);
      this._ws.on('open',   () => { this._reconnectAttempts = 0; this._sendSubscribe(securityIds); });
      this._ws.on('message',(d) => this._handleTick(d));
      this._ws.on('close',  () => { this._ws = null; setTimeout(() => this.subscribeTicks(symbols, onTick), Math.min(30000, 1000 * (++this._reconnectAttempts))); });
      this._ws.on('error',  (e) => console.error('[dhan ws]', e.message));
    } else {
      this._sendSubscribe(securityIds);
    }
    for (const id of securityIds) this._subscribedInstruments.add(id);
    return { added: securityIds, total: this._subscribedInstruments.size };
  }
  _sendSubscribe(securityIds) {
    if (!this._ws || this._ws.readyState !== 1) return;
    const msg = {
      RequestCode: 15,
      InstrumentCount: securityIds.length,
      InstrumentList: securityIds.map(id => ({ ExchangeSegment: 'NSE_EQ', SecurityId: String(id) })),
    };
    this._ws.send(JSON.stringify(msg));
  }
  _handleTick(data) {
    this._lastTickAt = Date.now();
    let tick;
    try {
      if (Buffer.isBuffer(data) && data.length >= 16) {
        tick = { instrument_token: data.readUInt32LE(3), last_price: data.readFloatLE(7), ts: this._lastTickAt };
      } else if (typeof data === 'string') {
        const j = JSON.parse(data);
        if (j && j.SecurityId) tick = { instrument_token: Number(j.SecurityId), last_price: Number(j.LTP || j.LastPrice || 0), ts: this._lastTickAt };
      }
    } catch (_) {}
    if (!tick) return;
    this._lastTicks.set(tick.instrument_token, tick);
    for (const sub of this._tickSubscribers) { try { sub(tick); } catch (_) {} }
  }
  async ensureSubscribed(symbols) {
    const securityIds = (symbols || []).map(s => this._symbolToSecurityId.get(s)).filter(Boolean);
    const added = securityIds.filter(id => !this._subscribedInstruments.has(id));
    if (added.length > 0 && this._ws) this._sendSubscribe(securityIds);
    for (const id of added) this._subscribedInstruments.add(id);
    return { added, total: this._subscribedInstruments.size };
  }

  async loadInstrumentMaster(rows) {
    this._instruments.clear();
    this._symbolToSecurityId.clear();
    for (const r of rows || []) {
      const id = r.SEM_SMST_SECURITY_ID || r.securityId;
      const sym = r.SEM_TRADING_SYMBOL  || r.tradingSymbol;
      if (!id || !sym) continue;
      this._instruments.set(id, { symbol: sym, segment: r.SEM_EXM_EXCH_ID || r.exchange, lotSize: Number(r.SEM_LOT_UNITS || r.lotSize || 1) });
      this._symbolToSecurityId.set(sym, id);
    }
    return { count: this._instruments.size };
  }
}

module.exports = { DhanBroker };

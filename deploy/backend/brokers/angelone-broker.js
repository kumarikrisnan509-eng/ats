// angelone-broker.js -- Tier 29: AngelOne (SmartAPI) adapter skeleton.
//
// AngelOne SmartAPI: https://smartapi.angelbroking.com/docs
// REST base:  https://apiconnect.angelbroking.com
// Auth: JWT-style access token from /auth/loginByPassword + TOTP (per-session refresh).
//
// SmartAPI's tick stream is via WebSocket v2 (wss://smartapisocket.angelone.in).
// Per-broker integer tokens; we'd need an instrument-master loader analogous to Kite's.
//
// SKELETON only -- every live method throws a clear not-implemented error.

class AngelOneBroker {
  constructor({ apiKey, clientCode, password, totpSecret, jwtToken, refreshToken, feedToken } = {}) {
    this.name = 'angelone';
    this.apiKey       = apiKey       || '';
    this.clientCode   = clientCode   || '';
    this.password     = password     || '';
    this.totpSecret   = totpSecret   || '';
    this.jwtToken     = jwtToken     || '';
    this.refreshToken = refreshToken || '';
    this.feedToken    = feedToken    || '';
    this._tickSubscribers = new Set();
    this._lastTicks = new Map();
    this._connected = false;
    this._subscribedInstruments = new Set();
  }

  setAccessToken(t) { this.jwtToken = t || ''; this._connected = !!this.jwtToken; }

  health() {
    return {
      name: this.name,
      connected: this._connected,
      subscribers: this._tickSubscribers.size,
      subscribedInstruments: this._subscribedInstruments.size,
      reconnectAttempts: 0,
      lastTickAt: 0,
      hasAccessToken: !!this.jwtToken,
      tickerInitialized: false,
      instruments: { size: 0, loadedAt: 0, ageSec: 0 },
      note: 'AngelOne adapter is skeleton-only. Set BROKER=zerodha for live data until SmartAPI wiring lands.',
    };
  }

  async start() { /* no live connection */ }
  async stop()  { /* no-op */ }

  _requireToken() {
    if (!this.jwtToken) throw new Error('angelone: no JWT token. Run loginByPassword + TOTP flow first.');
  }

  async getProfile()    { this._requireToken(); return this._stub('profile'); }
  async getHoldings()   { this._requireToken(); return []; }
  async getOrders()     { this._requireToken(); return []; }
  async getPositions()  { this._requireToken(); return { net: [], day: [] }; }
  async getMargins()    { this._requireToken(); return { equity: { available: { cash: 0 } } }; }

  async getHistorical(_args) {
    this._requireToken();
    throw new Error('angelone: getHistorical not implemented yet. POST /rest/secure/angelbroking/historical/v1/getCandleData needs wiring.');
  }
  async subscribeTicks(_symbols, _onTick) {
    this._requireToken();
    throw new Error('angelone: subscribeTicks not implemented yet. WebSocket wss://smartapisocket.angelone.in/smart-stream needs wiring.');
  }
  async ensureSubscribed(_symbols) {
    return { added: [], total: this._subscribedInstruments.size };
  }

  async placeOrder(_normalizedPayload) {
    this._requireToken();
    throw new Error('angelone: placeOrder not implemented yet. POST /rest/secure/angelbroking/order/v1/placeOrder needs wiring.');
  }
  async cancelOrder(_arg) {
    this._requireToken();
    throw new Error('angelone: cancelOrder not implemented yet.');
  }

  getLastTicks() { return Array.from(this._lastTicks.entries()).map(([symbol, ltp]) => ({ symbol, ltp })); }

  _stub(kind) {
    return { _stub: kind, message: 'AngelOne adapter is skeleton-only. Implement HTTP calls before live use.' };
  }
}

module.exports = { AngelOneBroker };

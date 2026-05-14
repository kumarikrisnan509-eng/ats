// upstox-broker.js -- Upstox adapter skeleton conforming to the same interface as ZerodhaBroker.
//
// Implements the public surface used by server.js:
//   start, stop, subscribeTicks, getHistorical, getHoldings, getOrders,
//   getPositions, getMargins, getProfile, ensureSubscribed, health,
//   setAccessToken, name
//
// Each method that requires live API access throws a clear error if accessToken
// is missing. The intent is that the user adds Upstox credentials when ready
// and the adapter "just works" without a separate refactor.
//
// Upstox API docs: https://upstox.com/developer/api-documentation/open-api
// Their tick stream is via WebSocket; here we leave it as a TODO marker.

class UpstoxBroker {
  constructor({ apiKey, apiSecret, accessToken, redirectUrl } = {}) {
    this.name = 'upstox';
    this.apiKey = apiKey || '';
    this.apiSecret = apiSecret || '';
    this.accessToken = accessToken || '';
    this.redirectUrl = redirectUrl || '';
    this._tickSubscribers = new Set();
    this._lastTicks = new Map();
    this._connected = false;
    this._subscribedInstruments = new Set();
  }

  setAccessToken(t) { this.accessToken = t || ''; this._connected = !!this.accessToken; }

  health() {
    return {
      name: this.name,
      connected: this._connected,
      subscribers: this._tickSubscribers.size,
      subscribedInstruments: this._subscribedInstruments.size,
      reconnectAttempts: 0,
      lastTickAt: 0,
      hasAccessToken: !!this.accessToken,
      tickerInitialized: false,
      instruments: { size: 0, loadedAt: 0, ageSec: 0 },
    };
  }

  async start() { /* No live connection until access token is set + Upstox WS wiring is implemented. */ }
  async stop()  { /* No-op. */ }

  _requireToken() {
    if (!this.accessToken) {
      throw new Error('upstox: no access token. Run the Upstox OAuth flow and call setAccessToken.');
    }
  }

  async getProfile()    { this._requireToken(); return this._stub('profile'); }
  async getHoldings()   { this._requireToken(); return []; }
  async getOrders()     { this._requireToken(); return []; }
  async getPositions()  { this._requireToken(); return { net: [], day: [] }; }
  async getMargins()    { this._requireToken(); return { equity: { available: { cash: 0 } } }; }

  async getHistorical(_args) {
    this._requireToken();
    throw new Error('upstox: getHistorical not implemented yet. See deploy/backend/brokers/upstox-broker.js TODO.');
  }

  async subscribeTicks(_symbols, _onTick) {
    this._requireToken();
    throw new Error('upstox: subscribeTicks not implemented yet. Use BROKER=zerodha until Upstox WS adapter ships.');
  }

  async ensureSubscribed(_symbols) {
    // Silent no-op for now; the autorun + alerts code calls this lazily.
    return { added: [], total: this._subscribedInstruments.size };
  }

  getLastTicks() { return Array.from(this._lastTicks.entries()).map(([symbol, ltp]) => ({ symbol, ltp })); }

  _stub(kind) {
    return { _stub: kind, message: 'Upstox adapter is skeleton-only. Implement HTTP calls before live use.' };
  }
}

module.exports = { UpstoxBroker };

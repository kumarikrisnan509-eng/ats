// dhan-broker.js -- Tier 29: DhanHQ adapter skeleton conforming to BrokerGateway.
//
// Implements the public surface used by server.js:
//   start, stop, subscribeTicks, getHistorical, getHoldings, getOrders,
//   getPositions, getMargins, getProfile, ensureSubscribed, health,
//   setAccessToken, name
//
// DhanHQ API: https://dhanhq.co/docs/v2/
// REST base:  https://api.dhan.co/v2
// Auth: long-lived API token (no daily refresh like Kite) + client-id header.
//
// This is a SKELETON. Live REST + WS wiring deferred to a later tier when a
// real Dhan API token is connected. Every method that needs live API access
// throws a clear "not implemented yet" error so the failure is loud, not silent.

class DhanBroker {
  constructor({ apiKey, accessToken, clientId } = {}) {
    this.name = 'dhan';
    this.apiKey = apiKey || '';
    this.accessToken = accessToken || '';
    this.clientId = clientId || '';
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
      note: 'Dhan adapter is skeleton-only. Set BROKER=zerodha for live data until Dhan REST + WS wiring lands.',
    };
  }

  async start() { /* no live connection until token + REST/WS impl */ }
  async stop()  { /* no-op */ }

  _requireToken() {
    if (!this.accessToken) throw new Error('dhan: no access token. Set DHAN_ACCESS_TOKEN env.');
    if (!this.clientId)    throw new Error('dhan: no client id. Set DHAN_CLIENT_ID env (your DhanHQ dashboard -> API).');
  }

  async getProfile()    { this._requireToken(); return this._stub('profile'); }
  async getHoldings()   { this._requireToken(); return []; }
  async getOrders()     { this._requireToken(); return []; }
  async getPositions()  { this._requireToken(); return { net: [], day: [] }; }
  async getMargins()    { this._requireToken(); return { equity: { available: { cash: 0 } } }; }

  async getHistorical(_args) {
    this._requireToken();
    throw new Error('dhan: getHistorical not implemented yet. POST https://api.dhan.co/v2/charts/historical needs wiring.');
  }
  async subscribeTicks(_symbols, _onTick) {
    this._requireToken();
    throw new Error('dhan: subscribeTicks not implemented yet. WebSocket wss://api-feed.dhan.co needs wiring.');
  }
  async ensureSubscribed(_symbols) {
    return { added: [], total: this._subscribedInstruments.size };
  }

  // Optional: placeOrder + cancelOrder once we go live. Spec §0 mandates Algo-ID
  // on every live order; server.js already requires it before calling broker.placeOrder.
  async placeOrder(_normalizedPayload) {
    this._requireToken();
    throw new Error('dhan: placeOrder not implemented yet. POST https://api.dhan.co/v2/orders needs wiring.');
  }
  async cancelOrder(_arg) {
    this._requireToken();
    throw new Error('dhan: cancelOrder not implemented yet.');
  }

  getLastTicks() { return Array.from(this._lastTicks.entries()).map(([symbol, ltp]) => ({ symbol, ltp })); }

  _stub(kind) {
    return { _stub: kind, message: 'Dhan adapter is skeleton-only. Implement HTTP calls before live use.' };
  }
}

module.exports = { DhanBroker };

// BrokerGateway — abstract base. Every broker adapter implements this contract.
//
// Live-trading safety: this interface does NOT have placeOrder/cancelOrder/modifyOrder.
// Read-only realtime data and an explicit placeDryRun for shape-testing only.
// When you eventually wire real orders, add the methods deliberately in a subclass and
// gate them behind a separate env flag (LIVE_ORDERS_ENABLED=true).

class BrokerGateway {
  /** @returns {string} adapter name e.g. "mock" or "zerodha" */
  get name() { throw new Error('not implemented'); }

  /** Lifecycle */
  async start() { /* connect to upstream feed */ }
  async stop()  { /* close upstream connections */ }

  /** Auth — only required by brokers that need per-user OAuth. */
  buildLoginUrl() { return null; }
  async exchangeRequestToken(_requestToken) { throw new Error('not supported'); }
  async refreshIfNeeded(_session) { return _session; }

  /**
   * Subscribe to a list of canonical symbols. Returns an unsubscribe fn.
   * Adapter calls onTick({ symbol, ltp, ts, change?, changePct? }) for each event.
   *
   * @param {string[]} symbols
   * @param {(tick: object) => void} onTick
   * @returns {Promise<() => void>}
   */
  async subscribeTicks(_symbols, _onTick) { throw new Error('not implemented'); }

  /**
   * One-shot quote.
   * @param {string} symbol
   * @returns {Promise<{ltp:number, ts:number}>}
   */
  async getQuote(_symbol) { throw new Error('not implemented'); }

  /**
   * Static list of symbols this broker supports. Used by /api/symbols.
   * @returns {Promise<string[]>}
   */
  async listSymbols() { return []; }

  /**
   * Add subscriptions to the SAME fan-out without registering a new callback.
   * Used by /ws handler when a connected client opts into more symbols.
   * Default impl is a no-op (suitable for brokers like MockBroker that already
   * tick every symbol regardless of subscription state).
   * @returns {Promise<{requested:number, resolved:number, newlySubscribed:number}>}
   */
  async ensureSubscribed(symbols) {
    return { requested: (symbols || []).length, resolved: (symbols || []).length, newlySubscribed: 0 };
  }

  /**
   * Bulk quote.
   * @param {string[]} symbols
   * @returns {Promise<object>} keyed by "EXCH:SYMBOL"
   */
  async getQuotes(_symbols) { return {}; }

  /**
   * Read-only account data. Default to empty so MockBroker can omit overrides.
   */
  async getHoldings()  { return []; }
  async getPositions(){ return { net: [], day: [] }; }
  async getOrders()   { return []; }
  async getProfile()  { return { broker: this.name }; }
  async getMargins()  { return {}; }

  /**
   * Historical OHLCV candles. Default returns empty.
   * @param {{symbol:string,interval:string,from:string,to:string,continuous?:boolean,oi?:boolean}} _args
   */
  async getHistorical(_args) { return []; }

  /**
   * In-memory symbol search. Default returns empty (only meaningful when an
   * instrument master is loaded — e.g. Zerodha).
   * @returns {Array<{symbol:string, token:number, exchange:string}>}
   */
  searchInstruments(_q, _limit) { return []; }

  /**
   * Order placement is intentionally NOT on this interface.
   * Use placeDryRun to test order payloads without hitting a broker.
   */
  async placeDryRun(_orderPayload) {
    return { ok: true, mode: 'dry-run', acceptedAt: new Date().toISOString() };
  }

  /** Health snapshot for /api/health */
  health() {
    return { name: this.name, connected: false, subscribers: 0 };
  }
}

module.exports = { BrokerGateway };

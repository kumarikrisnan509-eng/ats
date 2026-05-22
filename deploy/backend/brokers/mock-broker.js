// MockBroker — random-walk tick generator. Implements BrokerGateway.
// Use when BROKER=mock (default). Lets the cockpit run without a real broker subscription.

const { BrokerGateway } = require('./gateway');

const SEED = {
  'NIFTY 50':       24840.50,
  'BANKNIFTY':      53412.20,
  'SENSEX':         81234.80,
  'RELIANCE':       2887.40,
  'HDFCBANK':       1718.90,
  'TCS':            4012.55,
  'INFY':           1876.25,
  'ICICIBANK':      1284.70,
  'BAJFINANCE':     7654.30,
  'ITC':            462.80,
  'SBIN':           884.40,
  'LT':             3784.65,
  'TITAN':          3612.00,
  'BANKNIFTY FUT':  53358,
  'NIFTY 22550 CE': 97.25,
};

class MockBroker extends BrokerGateway {
  constructor() {
    super();
    this._state = Object.fromEntries(
      Object.entries(SEED).map(([k, v]) => [k, { ltp: v, prev: v, lastTs: Date.now() }])
    );
    this._subs = new Set(); // Set<(tick)=>void>
    this._timer = null;
  }

  get name() { return 'mock'; }

  async start() {
    if (this._timer) return;
    this._timer = setInterval(() => this._tickAll(), 800);
  }

  async stop() {
    if (this._timer) { clearInterval(this._timer); this._timer = null; }
    this._subs.clear();
  }

  _tickAll() {
    if (this._subs.size === 0) return;
    for (const [sym, s] of Object.entries(this._state)) {
      // Random walk: 60% small, 30% medium, 10% larger
      const p = Math.random();
      const pct = p < 0.6 ? (Math.random() - 0.5) * 0.0006
                : p < 0.9 ? (Math.random() - 0.5) * 0.0020
                          : (Math.random() - 0.5) * 0.0050;
      s.prev = s.ltp;
      s.ltp = Math.max(1, +(s.ltp * (1 + pct)).toFixed(2));
      s.lastTs = Date.now();
      const tick = {
        symbol: sym,
        ltp: s.ltp,
        ts: s.lastTs,
        change: +(s.ltp - s.prev).toFixed(2),
        changePct: +(((s.ltp - s.prev) / s.prev) * 100).toFixed(4),
      };
      for (const cb of this._subs) {
        try { cb(tick); } catch { /* one bad subscriber should not kill the loop */ }
      }
    }
  }

  async subscribeTicks(_symbols, onTick) {
    this._subs.add(onTick);
    // Immediate snapshot so the UI doesn't show blank for the first 800ms.
    for (const [sym, s] of Object.entries(this._state)) {
      try { onTick({ symbol: sym, ltp: s.ltp, ts: s.lastTs, change: 0, changePct: 0 }); } catch (e) { console.warn('[mock-broker] swallowed:', e && e.message); }
    }
    return () => { this._subs.delete(onTick); };
  }

  async getQuote(symbol) {
    const s = this._state[symbol];
    if (!s) throw new Error(`unknown symbol: ${symbol}`);
    return { ltp: s.ltp, ts: s.lastTs };
  }

  async getQuotes(symbols) {
    const out = {};
    for (const sym of (symbols || [])) {
      const key = sym.includes(':') ? sym : `NSE:${sym}`;
      const bare = key.includes(':') ? key.split(':')[1] : key;
      const s = this._state[bare];
      if (s) out[key] = { instrument_token: 0, last_price: s.ltp, ohlc: { open: s.prev, high: s.ltp, low: s.prev, close: s.prev } };
    }
    return out;
  }

  async listSymbols() {
    return Object.keys(this._state);
  }

  // Canned account data for the cockpit screens.
  async getHoldings() {
    return [
      { symbol: 'INFY',      exchange: 'NSE', quantity: 60,  avgPrice: 1843.00, ltp: this._state['INFY'] ? this._state['INFY'].ltp : 1876.25, pnl: 0, product: 'CNC' },
      { symbol: 'TCS',       exchange: 'NSE', quantity: 25,  avgPrice: 3920.50, ltp: this._state['TCS'] ? this._state['TCS'].ltp : 4012.55, pnl: 0, product: 'CNC' },
      { symbol: 'HDFCBANK',  exchange: 'NSE', quantity: 80,  avgPrice: 1612.30, ltp: this._state['HDFCBANK'] ? this._state['HDFCBANK'].ltp : 1718.90, pnl: 0, product: 'CNC' },
      { symbol: 'RELIANCE',  exchange: 'NSE', quantity: 40,  avgPrice: 2480.00, ltp: this._state['RELIANCE'] ? this._state['RELIANCE'].ltp : 2887.40, pnl: 0, product: 'CNC' },
    ].map(h => ({ ...h, pnl: +((h.ltp - h.avgPrice) * h.quantity).toFixed(2) }));
  }

  async getPositions() {
    return { net: [], day: [] };
  }

  async getOrders() {
    return [];
  }

  async getProfile() {
    return { userId: 'MOCK001', userName: 'Mock User', broker: 'mock', exchanges: ['NSE','NFO','BFO','MCX'] };
  }

  async getMargins() {
    return { equity: { available: { cash: 100000 }, utilised: { debits: 0 } } };
  }

  async getHistorical({ symbol, interval, from, to }) {
    // Random walk for demo. Roughly mimics market hours but doesn't pretend
    // to be accurate.
    const intervalSec = {
      'minute': 60, '3minute': 180, '5minute': 300, '10minute': 600,
      '15minute': 900, '30minute': 1800, '60minute': 3600, 'day': 86400,
    }[interval] || 300;
    const fromMs = new Date(from).getTime();
    const toMs   = new Date(to).getTime();
    if (!fromMs || !toMs || toMs <= fromMs) return [];
    const seed = (this._state[symbol] && this._state[symbol].ltp) || 1000;
    const out = [];
    let v = seed * 0.95;
    for (let t = fromMs; t <= toMs; t += intervalSec * 1000) {
      const o = v;
      const change = (Math.random() - 0.5) * 0.01;
      const c = +(v * (1 + change)).toFixed(2);
      const h = +Math.max(o, c, o * (1 + Math.random() * 0.005)).toFixed(2);
      const l = +Math.min(o, c, o * (1 - Math.random() * 0.005)).toFixed(2);
      out.push({ date: new Date(t).toISOString(), open: o, high: h, low: l, close: c, volume: Math.floor(50000 + Math.random() * 200000) });
      v = c;
      if (out.length > 2000) break;
    }
    return out;
  }

  searchInstruments(q, limit) {
    if (!q) return [];
    const needle = String(q).toUpperCase();
    const cap = Math.max(1, Math.min(50, limit || 20));
    return Object.keys(this._state)
      .filter(s => s.toUpperCase().includes(needle))
      .slice(0, cap)
      .map(s => ({ symbol: s, token: 0, exchange: 'NSE' }));
  }

  health() {
    // Phase A.5: expose the same shape fields the zerodha broker does so the
    // /api/health-deep contract is identical across brokers. T-34/T-37/T-42
    // tests assert these as booleans; pre-A.5 mock broker omitted them and
    // the test had a skip-when-mock guard that silently weakened coverage.
    return {
      name: this.name,
      connected: this._timer != null,
      subscribers: this._subs.size,
      stalledOnToken: false,
      tickStale: false,
      hasAccessToken: true,
      tickerInitialized: this._timer != null,
      reconnectAttempts: 0,
      subscribedInstruments: this._subs.size,
      lagMs: 0,
    };
  }
}

module.exports = { MockBroker };

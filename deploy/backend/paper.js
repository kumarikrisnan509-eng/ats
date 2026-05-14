// paper.js -- paper trading simulator.
//
// Live ticks from the broker drive fills. MARKET orders fill at the next tick
// for that symbol; LIMIT orders fill when the tick crosses the limit price.
// Positions are tracked FIFO and realized P&L is computed when a position is
// fully or partially closed. Unrealized P&L is computed using the most recent
// tick at read-time.
//
// State persists to /var/lib/ats/tokens/_paper.json. Survives container
// restarts. Reset wipes everything and restores starting cash.
//
// Public API:
//   const p = new PaperTrading({ storePath, audit, startingCash, lastTicks });
//   p.load();
//   p.placeOrder({ symbol, side, qty, type, price? })  -> order
//   p.cancelOrder(id)                                  -> { cancelled, order }
//   p.list()                                           -> orders array
//   p.positions()                                      -> array with unrealized P&L
//   p.trades()                                         -> closed-trade ledger
//   p.stats()                                          -> totals
//   p.reset()                                          -> clears all state
//   p.onTick({symbol, ltp, ts})                        -> hot path; fills + persists

const fs   = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_STORE = '/var/lib/ats/tokens/_paper.json';
const DEFAULT_CASH  = 1000000; // INR 10 lakhs starting capital

class PaperTrading {
  /**
   * @param {object} opts
   * @param {string} [opts.storePath]
   * @param {number} [opts.startingCash]
   * @param {(event, data) => void} [opts.audit]
   * @param {() => Map<string,number>} [opts.lastTicks]  function returning current last-tick map for mark-to-market
   */
  constructor({ storePath, startingCash, audit, lastTicks } = {}) {
    this.storePath     = storePath     || DEFAULT_STORE;
    this.startingCash  = startingCash  || DEFAULT_CASH;
    this.audit         = audit         || (() => {});
    this.lastTicks     = lastTicks     || (() => new Map());
    this._orders       = [];
    this._positions    = {};  // symbol -> { qty, avgPrice, openedAt }
    this._trades       = [];  // closed trades
    this._cash         = this.startingCash;
    this._persistDebounce = null;
  }

  load() {
    try {
      if (!fs.existsSync(this.storePath)) return;
      const raw = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      if (raw && typeof raw === 'object') {
        this._orders    = Array.isArray(raw.orders)    ? raw.orders    : [];
        this._positions = (raw.positions && typeof raw.positions === 'object') ? raw.positions : {};
        this._trades    = Array.isArray(raw.trades)    ? raw.trades    : [];
        this._cash      = typeof raw.cash === 'number' ? raw.cash      : this.startingCash;
        console.log(`[paper] loaded: ${this._orders.length} orders, ${Object.keys(this._positions).length} positions, ${this._trades.length} closed trades, cash=INR ${this._cash}`);
      }
    } catch (e) { console.warn('[paper] load failed:', e.message); }
  }

  _persist() {
    try {
      fs.mkdirSync(path.dirname(this.storePath), { recursive: true });
      fs.writeFileSync(this.storePath, JSON.stringify({
        orders: this._orders.slice(-1000),   // cap at last 1000 orders
        positions: this._positions,
        trades: this._trades.slice(-2000),   // last 2000 trades
        cash: this._cash,
      }, null, 2));
    } catch (e) { console.error('[paper] persist failed:', e.message); }
  }

  _schedulePersist() {
    if (this._persistDebounce) return;
    this._persistDebounce = setTimeout(() => {
      this._persistDebounce = null;
      this._persist();
    }, 2000).unref();
  }

  placeOrder({ symbol, side, qty, type, price, strategy }) {
    if (!symbol || typeof symbol !== 'string') throw new Error('symbol required');
    side = String(side || '').toUpperCase();
    if (side !== 'BUY' && side !== 'SELL') throw new Error('side must be BUY or SELL');
    type = String(type || 'MARKET').toUpperCase();
    if (type !== 'MARKET' && type !== 'LIMIT') throw new Error('type must be MARKET or LIMIT');
    const q = Math.floor(Number(qty));
    if (!Number.isFinite(q) || q <= 0) throw new Error('qty must be > 0');
    let p = null;
    if (type === 'LIMIT') {
      p = Number(price);
      if (!Number.isFinite(p) || p <= 0) throw new Error('LIMIT order needs price > 0');
    }
    const strat = (strategy && typeof strategy === 'string') ? strategy.trim().slice(0, 64) : null;
    const order = {
      id: crypto.randomUUID(),
      symbol: symbol.trim(),
      side, qty: q, type, price: p,
      strategy: strat,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      filledAt: null, filledPrice: null,
    };
    this._orders.push(order);
    this.audit('paper.order.placed', { id: order.id, symbol: order.symbol, side, qty: q, type, price: p, strategy: strat });
    this._schedulePersist();
    return order;
  }

  cancelOrder(id) {
    const o = this._orders.find(x => x.id === id);
    if (!o) return { cancelled: false, reason: 'not_found' };
    if (o.status !== 'PENDING') return { cancelled: false, reason: 'already_' + o.status.toLowerCase(), order: o };
    o.status = 'CANCELLED';
    o.cancelledAt = new Date().toISOString();
    this.audit('paper.order.cancelled', { id });
    this._schedulePersist();
    return { cancelled: true, order: o };
  }

  /** Hot path -- called on every tick from the broker fan-out. */
  onTick(tick) {
    if (!tick || typeof tick.symbol !== 'string' || typeof tick.ltp !== 'number') return;
    let changed = false;
    for (const o of this._orders) {
      if (o.status !== 'PENDING' || o.symbol !== tick.symbol) continue;
      let fillPrice = null;
      if (o.type === 'MARKET') {
        fillPrice = tick.ltp;
      } else if (o.type === 'LIMIT') {
        if (o.side === 'BUY'  && tick.ltp <= o.price) fillPrice = o.price;
        if (o.side === 'SELL' && tick.ltp >= o.price) fillPrice = o.price;
      }
      if (fillPrice == null) continue;
      this._fill(o, fillPrice);
      changed = true;
    }
    if (changed) this._schedulePersist();
  }

  _fill(order, price) {
    order.status     = 'FILLED';
    order.filledAt   = new Date().toISOString();
    order.filledPrice = price;
    const symbol = order.symbol;
    const sign = order.side === 'BUY' ? 1 : -1;
    const cost = sign * order.qty * price;
    this._cash -= cost;

    const pos = this._positions[symbol];
    if (!pos) {
      // Opening a new position
      this._positions[symbol] = {
        qty: sign * order.qty,
        avgPrice: price,
        openedAt: order.filledAt,
      };
    } else {
      const sameDir = (pos.qty > 0 && sign > 0) || (pos.qty < 0 && sign < 0);
      if (sameDir) {
        // Add to position; new avg = weighted
        const totalQty = pos.qty + sign * order.qty;
        const totalCost = pos.avgPrice * Math.abs(pos.qty) + price * order.qty;
        pos.avgPrice = totalCost / Math.abs(totalQty);
        pos.qty = totalQty;
      } else {
        // Reducing or flipping the position -> realized P&L on the closed portion
        const closingQty = Math.min(Math.abs(pos.qty), order.qty);
        const realized = (price - pos.avgPrice) * (pos.qty > 0 ? closingQty : -closingQty);
        this._trades.push({
          symbol, side: pos.qty > 0 ? 'LONG' : 'SHORT',
          openedAt: pos.openedAt, closedAt: order.filledAt,
          qty: closingQty, openPrice: pos.avgPrice, closePrice: price,
          realizedPnl: +realized.toFixed(2),
          strategy: order.strategy || null,
        });
        const newQty = pos.qty + sign * order.qty;
        if (Math.abs(newQty) < 1e-9) {
          delete this._positions[symbol];
        } else if ((pos.qty > 0 && newQty < 0) || (pos.qty < 0 && newQty > 0)) {
          // Flipped direction -> new position with whatever's left
          this._positions[symbol] = { qty: newQty, avgPrice: price, openedAt: order.filledAt };
        } else {
          pos.qty = newQty;
          // avg stays the same on partial close
        }
      }
    }
    this.audit('paper.order.filled', { id: order.id, symbol, side: order.side, qty: order.qty, price });
  }

  list() {
    return this._orders.slice().reverse(); // newest first
  }

  positions() {
    const ticks = this.lastTicks();
    return Object.entries(this._positions).map(([sym, p]) => {
      const ltp = ticks instanceof Map ? ticks.get(sym) : null;
      const unrealized = ltp != null ? (ltp - p.avgPrice) * p.qty : 0;
      return {
        symbol: sym,
        qty: p.qty,
        avgPrice: p.avgPrice,
        ltp: ltp != null ? ltp : null,
        unrealizedPnl: +unrealized.toFixed(2),
        openedAt: p.openedAt,
      };
    });
  }

  trades(limit) {
    const n = Math.max(1, Math.min(500, limit || 100));
    return this._trades.slice(-n).reverse();
  }

  stats() {
    const ticks = this.lastTicks();
    let unrealized = 0;
    for (const [sym, p] of Object.entries(this._positions)) {
      const ltp = ticks instanceof Map ? ticks.get(sym) : null;
      if (ltp != null) unrealized += (ltp - p.avgPrice) * p.qty;
    }
    const realized = this._trades.reduce((s, t) => s + t.realizedPnl, 0);
    const wins   = this._trades.filter(t => t.realizedPnl > 0).length;
    const losses = this._trades.filter(t => t.realizedPnl < 0).length;
    return {
      cash:            +this._cash.toFixed(2),
      openPositions:   Object.keys(this._positions).length,
      totalOrders:     this._orders.length,
      filledOrders:    this._orders.filter(o => o.status === 'FILLED').length,
      pendingOrders:   this._orders.filter(o => o.status === 'PENDING').length,
      cancelledOrders: this._orders.filter(o => o.status === 'CANCELLED').length,
      closedTrades:    this._trades.length,
      wins, losses,
      winRate:         this._trades.length ? +(wins / this._trades.length * 100).toFixed(2) : 0,
      realizedPnl:     +realized.toFixed(2),
      unrealizedPnl:   +unrealized.toFixed(2),
      totalEquity:     +(this._cash + unrealized + this._positionsValue(ticks)).toFixed(2),
    };
  }

  _positionsValue(ticks) {
    let v = 0;
    for (const [sym, p] of Object.entries(this._positions)) {
      const ltp = ticks instanceof Map ? ticks.get(sym) : null;
      if (ltp != null) v += ltp * p.qty;
    }
    return v;
  }

  reset() {
    this._orders    = [];
    this._positions = {};
    this._trades    = [];
    this._cash      = this.startingCash;
    this._persist();
    this.audit('paper.reset', { startingCash: this.startingCash });
  }
}

module.exports = { PaperTrading };

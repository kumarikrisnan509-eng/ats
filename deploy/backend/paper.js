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
// Tier 28: spec §2.2 calls for tiered ₹10L/₹25L/₹50L paper accounts.
const VALID_TIERS = {
  '10L': 1000000,
  '25L': 2500000,
  '50L': 5000000,
};

class PaperTrading {
  /**
   * @param {object} opts
   * @param {string} [opts.storePath]
   * @param {number} [opts.startingCash]
   * @param {(event, data) => void} [opts.audit]
   * @param {() => Map<string,number>} [opts.lastTicks]  function returning current last-tick map for mark-to-market
   */
  constructor({ storePath, startingCash, audit, lastTicks, getTslConfig } = {}) {
    this.storePath     = storePath     || DEFAULT_STORE;
    this.startingCash  = startingCash  || DEFAULT_CASH;
    this.audit         = audit         || (() => {});
    this.lastTicks     = lastTicks     || (() => new Map());
    this._orders       = [];
    this._positions    = {};  // symbol -> { qty, avgPrice, openedAt }
    this._trades       = [];  // closed trades
    this._cash         = this.startingCash;
    this._persistDebounce = null;
    // T-269: TSL config getter. Returns {tslActivatePct, tslGapPct}; safe defaults
    // if the getter is absent or returns null. Read PER-TICK so config edits
    // propagate within ~60s (the risk-config cachedGet TTL).
    this.getTslConfig = (typeof getTslConfig === 'function') ? getTslConfig : (() => null);
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

  placeOrder({ symbol, side, qty, type, price, triggerPrice, targetPrice, stopLoss, strategy }) {
    if (!symbol || typeof symbol !== 'string') throw new Error('symbol required');
    side = String(side || '').toUpperCase();
    if (side !== 'BUY' && side !== 'SELL') throw new Error('side must be BUY or SELL');
    type = String(type || 'MARKET').toUpperCase();
    // Tier 23 added SL/SL-M; Tier 26 adds BRACKET.
    const VALID = ['MARKET', 'LIMIT', 'SL', 'SL-M', 'BRACKET'];
    if (!VALID.includes(type)) throw new Error('type must be one of: ' + VALID.join(', '));
    const q = Math.floor(Number(qty));
    if (!Number.isFinite(q) || q <= 0) throw new Error('qty must be > 0');
    let p = null, tp = null, tgt = null, sl = null;
    if (type === 'LIMIT' || type === 'SL') {
      p = Number(price);
      if (!Number.isFinite(p) || p <= 0) throw new Error(type + ' order needs price > 0');
    }
    if (type === 'SL' || type === 'SL-M') {
      tp = Number(triggerPrice);
      if (!Number.isFinite(tp) || tp <= 0) throw new Error(type + ' order needs triggerPrice > 0');
    }
    if (type === 'BRACKET') {
      // BRACKET = 3-legged OCO. Entry can be MARKET (price null) or LIMIT (price required).
      // targetPrice and stopLoss are mandatory.
      if (price != null) {
        p = Number(price);
        if (!Number.isFinite(p) || p <= 0) throw new Error('BRACKET LIMIT entry needs price > 0');
      }
      tgt = Number(targetPrice);
      sl  = Number(stopLoss);
      if (!Number.isFinite(tgt) || tgt <= 0) throw new Error('BRACKET order needs targetPrice > 0');
      if (!Number.isFinite(sl)  || sl  <= 0) throw new Error('BRACKET order needs stopLoss > 0');
      // Sanity: target > stop for BUY, target < stop for SELL
      if (side === 'BUY'  && !(tgt > sl)) throw new Error('BRACKET BUY needs targetPrice > stopLoss');
      if (side === 'SELL' && !(tgt < sl)) throw new Error('BRACKET SELL needs targetPrice < stopLoss');
    }
    const strat = (strategy && typeof strategy === 'string') ? strategy.trim().slice(0, 64) : null;
    // T-238 (P1 FIX): strip Indian exchange prefix so the order's stored symbol
    // matches the bare symbol that Kite delivers via WebSocket ticks. Otherwise
    // a user placing `NSE:RELIANCE` from the UI sits eternally PENDING because
    // tick.symbol is `RELIANCE` and the onTick() matcher uses strict equality
    // (line 221: `o.symbol !== tick.symbol`). Caught by live A/B test in T-237.
    const _bareSymbol = String(symbol).trim().replace(/^(NSE|BSE|NFO|BFO|MCX|CDS):/, '');
    const order = {
      id: crypto.randomUUID(),
      symbol: _bareSymbol,
      side, qty: q, type,
      price: p, triggerPrice: tp, targetPrice: tgt, stopLoss: sl,
      strategy: strat,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      filledAt: null, filledPrice: null,
      // Tier 26: bracket linkage
      bracketRole: type === 'BRACKET' ? 'entry' : null,
      parentId: null,
      childIds: [],
    };
    this._orders.push(order);
    this.audit('paper.order.placed', { id: order.id, symbol: order.symbol, side, qty: q, type, price: p, triggerPrice: tp, targetPrice: tgt, stopLoss: sl, strategy: strat });
    this._schedulePersist();
    return order;
  }

  // Tier 26: helper -- spawn target + stop child orders for a filled bracket entry.
  _spawnBracketChildren(entry) {
    const closingSide = entry.side === 'BUY' ? 'SELL' : 'BUY';
    const tgtChild = {
      id: crypto.randomUUID(),
      symbol: entry.symbol,
      side: closingSide,
      qty: entry.qty,
      type: 'LIMIT',
      price: entry.targetPrice,
      triggerPrice: null,
      strategy: entry.strategy,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      filledAt: null, filledPrice: null,
      bracketRole: 'target',
      parentId: entry.id,
      childIds: [],
    };
    const stopChild = {
      id: crypto.randomUUID(),
      symbol: entry.symbol,
      side: closingSide,
      qty: entry.qty,
      type: 'SL-M',
      price: null,
      triggerPrice: entry.stopLoss,
      strategy: entry.strategy,
      status: 'PENDING',
      createdAt: new Date().toISOString(),
      filledAt: null, filledPrice: null,
      bracketRole: 'stop',
      parentId: entry.id,
      childIds: [],
      // T-269: TSL bookkeeping
      entrySide: entry.side,                       // 'BUY' or 'SELL' of the bracket entry
      entryFilledPrice: entry.filledPrice,         // captured at spawn (entry already filled)
      tslState: {
        active: false,
        peakLtp: entry.filledPrice,
        originalTrigger: entry.stopLoss,
        lastUpdatedAt: null,
        updates: 0,
      },
    };
    this._orders.push(tgtChild, stopChild);
    entry.childIds = [tgtChild.id, stopChild.id];
    this.audit('paper.bracket.spawned', { parent: entry.id, target: tgtChild.id, stop: stopChild.id });
  }

  // Tier 26: when one bracket leg fills, cancel its sibling (OCO).
  _cancelBracketSibling(filledChild) {
    if (!filledChild.parentId) return;
    const parent = this._orders.find(o => o.id === filledChild.parentId);
    if (!parent || !parent.childIds) return;
    for (const cid of parent.childIds) {
      if (cid === filledChild.id) continue;
      const sibling = this._orders.find(o => o.id === cid);
      if (sibling && sibling.status === 'PENDING') {
        sibling.status = 'CANCELLED';
        sibling.cancelledAt = new Date().toISOString();
        sibling.cancelReason = 'oco_sibling_filled';
        this.audit('paper.bracket.oco_cancel', { sibling: cid, byFillOf: filledChild.id });
      }
    }
  }

  // T-269: trailing-stop-loss update for active bracket stop children.
  // Called from onTick before the fill-check pass. Pure: only mutates the
  // stop child's triggerPrice + tslState. Never fills or cancels.
  _updateTslForTick(tick) {
    const cfg = this.getTslConfig() || {};
    const tslActivatePct = Number.isFinite(cfg.tslActivatePct) ? cfg.tslActivatePct : 0.005;
    const tslGapPct      = Number.isFinite(cfg.tslGapPct)      ? cfg.tslGapPct      : 0.003;
    if (tslActivatePct <= 0 || tslGapPct <= 0) return;   // disabled

    for (const o of this._orders) {
      if (o.bracketRole !== 'stop') continue;
      if (o.status !== 'PENDING') continue;
      if (o.symbol !== tick.symbol) continue;
      if (!o.tslState || !Number.isFinite(o.entryFilledPrice)) continue;

      const ltp = tick.ltp;
      const st = o.tslState;

      if (o.entrySide === 'BUY') {
        // Long bracket: stop is a SELL SL-M with triggerPrice BELOW entry.
        // Activate once price has risen tslActivatePct above entry, then trail
        // the trigger up so it sits tslGapPct below the running peak.
        if (!st.active) {
          if (ltp >= o.entryFilledPrice * (1 + tslActivatePct)) {
            st.active = true;
            st.peakLtp = ltp;
            const newTrigger = Math.max(o.triggerPrice, ltp * (1 - tslGapPct));
            if (newTrigger > o.triggerPrice) {
              o.triggerPrice = newTrigger;
              st.lastUpdatedAt = new Date().toISOString();
              st.updates++;
              this.audit('paper.tsl.activated', {
                stopId: o.id, parent: o.parentId, side: o.entrySide,
                entryPrice: o.entryFilledPrice, ltp, newTrigger,
              });
            }
          }
        } else if (ltp > st.peakLtp) {
          st.peakLtp = ltp;
          const newTrigger = ltp * (1 - tslGapPct);
          if (newTrigger > o.triggerPrice) {
            const oldTrigger = o.triggerPrice;
            o.triggerPrice = newTrigger;
            st.lastUpdatedAt = new Date().toISOString();
            st.updates++;
            this.audit('paper.tsl.trailed', {
              stopId: o.id, ltp, oldTrigger, newTrigger, peak: st.peakLtp,
            });
          }
        }
      } else if (o.entrySide === 'SELL') {
        // Short bracket: stop is a BUY SL-M with triggerPrice ABOVE entry.
        // Activate once price has fallen tslActivatePct below entry, then trail
        // the trigger down so it sits tslGapPct above the running trough.
        if (!st.active) {
          if (ltp <= o.entryFilledPrice * (1 - tslActivatePct)) {
            st.active = true;
            st.peakLtp = ltp;   // peak is the lowest seen for shorts
            const newTrigger = Math.min(o.triggerPrice, ltp * (1 + tslGapPct));
            if (newTrigger < o.triggerPrice) {
              o.triggerPrice = newTrigger;
              st.lastUpdatedAt = new Date().toISOString();
              st.updates++;
              this.audit('paper.tsl.activated', {
                stopId: o.id, parent: o.parentId, side: o.entrySide,
                entryPrice: o.entryFilledPrice, ltp, newTrigger,
              });
            }
          }
        } else if (ltp < st.peakLtp) {
          st.peakLtp = ltp;
          const newTrigger = ltp * (1 + tslGapPct);
          if (newTrigger < o.triggerPrice) {
            const oldTrigger = o.triggerPrice;
            o.triggerPrice = newTrigger;
            st.lastUpdatedAt = new Date().toISOString();
            st.updates++;
            this.audit('paper.tsl.trailed', {
              stopId: o.id, ltp, oldTrigger, newTrigger, trough: st.peakLtp,
            });
          }
        }
      }
    }
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

  /** Hot path -- called on every tick from the broker fan-out.
   *  Tier 23: added SL + SL-M handling and a small slippage model on aggressive fills. */
  onTick(tick) {
    if (!tick || typeof tick.symbol !== 'string' || typeof tick.ltp !== 'number') return;
    // T-269: trail any active bracket stop children BEFORE checking fills.
    // Trailing only widens favourably -- it never makes the trigger easier
    // to hit, so we can do this even on the same tick that ends up filling.
    this._updateTslForTick(tick);
    let changed = false;
    for (const o of this._orders) {
      if (o.status !== 'PENDING' || o.symbol !== tick.symbol) continue;
      let fillPrice = null;
      let isAggressive = false; // MARKET or SL-M fills cross the spread
      if (o.type === 'MARKET') {
        fillPrice = tick.ltp;
        isAggressive = true;
      } else if (o.type === 'BRACKET') {
        // Tier 26: BRACKET entry fills like MARKET if price is null, otherwise like LIMIT.
        if (o.price == null) { fillPrice = tick.ltp; isAggressive = true; }
        else if (o.side === 'BUY'  && tick.ltp <= o.price) fillPrice = o.price;
        else if (o.side === 'SELL' && tick.ltp >= o.price) fillPrice = o.price;
      } else if (o.type === 'LIMIT') {
        if (o.side === 'BUY'  && tick.ltp <= o.price) fillPrice = o.price;
        if (o.side === 'SELL' && tick.ltp >= o.price) fillPrice = o.price;
      } else if (o.type === 'SL') {
        // Stop-loss limit: once trigger is breached, become a LIMIT at \`price\`.
        // BUY-SL is used to cap an upward break (trigger ABOVE current price).
        // SELL-SL is used to cap a downward break (trigger BELOW current price).
        if (o.side === 'BUY'  && tick.ltp >= o.triggerPrice) {
          // limit to o.price; fills only if market then comes back to <= price
          if (tick.ltp <= o.price) fillPrice = o.price;
        }
        if (o.side === 'SELL' && tick.ltp <= o.triggerPrice) {
          if (tick.ltp >= o.price) fillPrice = o.price;
        }
      } else if (o.type === 'SL-M') {
        // Stop-loss market: once trigger is breached, become a MARKET order.
        if (o.side === 'BUY'  && tick.ltp >= o.triggerPrice) { fillPrice = tick.ltp; isAggressive = true; }
        if (o.side === 'SELL' && tick.ltp <= o.triggerPrice) { fillPrice = tick.ltp; isAggressive = true; }
      }
      if (fillPrice == null) continue;
      // Tier 23: slippage model -- aggressive fills (MARKET, SL-M) cost 5 bps of price worse for the taker.
      if (isAggressive) {
        const slipBps = Number(process.env.PAPER_SLIPPAGE_BPS || 0);  // Tier 23: opt-in via env
        const slip = fillPrice * (slipBps / 10000);
        fillPrice = o.side === 'BUY' ? fillPrice + slip : fillPrice - slip;
      }
      this._fill(o, fillPrice);
      // Tier 26: bracket order lifecycle
      // T-357: wrap in try/catch. Backend-reliability audit T-355 flagged this
      // as CRITICAL: if _spawnBracketChildren throws (e.g. malformed entry,
      // crypto.randomUUID failure, persist error), the entry fill is already
      // recorded but the target/stop children are never created -- result is
      // an unprotected position. Now: log + audit on failure, position still
      // protected by the next pull-from-cancellation pass.
      if (o.bracketRole === 'entry') {
        try {
          this._spawnBracketChildren(o);
        } catch (e) {
          // Position is open without target/stop. Log loudly so an alert can fire.
          console.error('[paper] CRITICAL: bracket spawn failed for entry', o.id, e);
          try {
            if (typeof this._auditCb === 'function') {
              this._auditCb('paper.bracket.spawnError', { entryId: o.id, symbol: o.symbol, qty: o.qty, error: e && e.message });
            }
          } catch (auditErr) { /* never let audit kill the loop */ }
        }
      } else if (o.bracketRole === 'target' || o.bracketRole === 'stop') {
        try {
          this._cancelBracketSibling(o);
        } catch (e) {
          // Sibling not cancelled -- could leave a stale order. Log so reconciliation catches it.
          console.error('[paper] bracket sibling cancel failed for', o.id, e);
        }
      }
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

  reset(opts) {
    // Tier 28: allow reset to choose a new starting tier.
    if (opts && opts.tier) {
      const v = VALID_TIERS[String(opts.tier).toUpperCase()];
      if (!v) throw new Error('tier must be one of: ' + Object.keys(VALID_TIERS).join(', '));
      this.startingCash = v;
    } else if (opts && Number.isFinite(opts.startingCash) && opts.startingCash > 0) {
      this.startingCash = Math.floor(opts.startingCash);
    }
    this._orders    = [];
    this._positions = {};
    this._trades    = [];
    this._cash      = this.startingCash;
    this._persist();
    this.audit('paper.reset', { startingCash: this.startingCash, tier: opts && opts.tier });
    return { startingCash: this.startingCash };
  }

  availableTiers() {
    return Object.entries(VALID_TIERS).map(([tier, cash]) => ({ tier, startingCash: cash }));
  }
}

module.exports = { PaperTrading };

'use strict';

// ============================================================================
// paper-adapter.js  (T-536 step 3 — Phase 2 of the paper-engine unification)
// ----------------------------------------------------------------------------
// Gives autorun (and any caller) the MINIMAL interface it needs —
//   placeOrder(payload) -> { id, status, fillPrice? }
//   positions()         -> [{ symbol, qty, avgPrice, openedAt }]
// — backed by the PER-USER db.paper tables (paper_orders / paper_positions /
// paper_closed_trades / paper_state) for a fixed user id.
//
// Why: before T-536, autorun wrote paper orders to the legacy GLOBAL paper
// singleton (paper_singleton_state). After T-536 Phase 1 the UI reads ONLY
// from per-user db.paper, so autorun's paper trades were invisible. This
// adapter makes autorun write where the UI reads.
//
// Fill model: SYNCHRONOUS at a reference price (broker LTP if available, else
// payload.refPrice / payload.price — autorun passes the signal bar's close),
// with the same slippage model as POST /api/me/paper/order. Long-only, matching
// the per-user order route and the (long-only) registered strategies. The
// legacy singleton's tick-driven SL/TP/TSL simulation is intentionally NOT
// reproduced here (protective-exit simulation is a separate, later phase --
// the live path likewise defers SL/TP to GTT). A SELL with no / insufficient
// position is capped to the held qty, or recorded as a cancelled order.
// ============================================================================

function createPaperAdapter({ getDb, uid, getLtp, audit, slippageBps } = {}) {
  if (typeof getDb !== 'function') throw new Error('paper-adapter: getDb function required');
  const UID = Number(uid);
  if (!Number.isInteger(UID)) throw new Error('paper-adapter: integer uid required');
  const _audit = (typeof audit === 'function') ? audit : () => {};
  const defaultSlipBps = Number.isFinite(slippageBps) ? Number(slippageBps) : 5;

  function _refPrice(symbol, payload) {
    // 1) explicit reference price from the caller (autorun passes bar close)
    const p = Number(payload && (payload.refPrice != null ? payload.refPrice : payload.price));
    if (Number.isFinite(p) && p > 0) return p;
    // 2) live LTP getter (broker last tick), if provided
    if (typeof getLtp === 'function') {
      try { const v = Number(getLtp(symbol)); if (Number.isFinite(v) && v > 0) return v; } catch (_) { /* ignore */ }
    }
    return null;
  }

  function _record(db, o) {
    // o must contain EXACTLY the 13 named params paperPlaceOrder binds.
    db.paper.placeOrder(o);
  }

  return {
    _uid: UID,

    positions() {
      const db = getDb();
      let rows = [];
      try { rows = db.paper.listPositions(UID) || []; } catch (_) { rows = []; }
      return rows.map(r => ({
        symbol: r.symbol,
        qty: Number(r.qty || 0),
        avgPrice: Number(r.avg_price || 0),
        openedAt: r.opened_at || null,
      }));
    },

    placeOrder(payload) {
      const db = getDb();
      const symbol = String((payload && payload.symbol) || '').toUpperCase().trim();
      const side = String((payload && payload.side) || '').toUpperCase();
      const qty = Math.floor(Number(payload && payload.qty));
      const strategy = (payload && payload.strategy) || null;
      const orderId = 'PA-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
      if (!symbol || !['BUY', 'SELL'].includes(side) || !(qty > 0)) {
        throw new Error('paper-adapter: bad order (symbol/side/qty required)');
      }

      const ltp = _refPrice(symbol, payload);
      if (ltp == null) {
        _record(db, { user_id: UID, client_order_id: orderId, strategy_tag: strategy,
          symbol, side, qty, order_type: (payload && payload.type) || 'MARKET', product: 'CNC',
          req_price: null, fill_price: null, slippage: null, status: 'cancelled', filled_at: null });
        _audit('paper.adapter.cancelled', { uid: UID, orderId, symbol, side, qty, reason: 'no_price' });
        return { id: orderId, status: 'cancelled', reason: 'no_price' };
      }

      const slipBps = Number.isFinite(payload && payload.slippageBps) ? Number(payload.slippageBps) : defaultSlipBps;
      const slippage = ltp * (slipBps / 10000);
      const fillPrice = side === 'BUY' ? ltp + slippage : ltp - slippage;
      const state = db.paper.getState(UID);
      const positions = db.paper.listPositions(UID) || [];
      const existing = positions.find(p => p.symbol === symbol);

      if (side === 'BUY') {
        const notional = fillPrice * qty;
        if (Number(state.cash || 0) < notional) {
          _record(db, { user_id: UID, client_order_id: orderId, strategy_tag: strategy,
            symbol, side, qty, order_type: 'MARKET', product: 'CNC',
            req_price: ltp, fill_price: fillPrice, slippage, status: 'cancelled', filled_at: null });
          _audit('paper.adapter.cancelled', { uid: UID, orderId, symbol, reason: 'insufficient_cash', cash: state.cash, needed: notional });
          return { id: orderId, status: 'cancelled', reason: 'insufficient_cash' };
        }
        _record(db, { user_id: UID, client_order_id: orderId, strategy_tag: strategy,
          symbol, side, qty, order_type: 'MARKET', product: 'CNC',
          req_price: ltp, fill_price: fillPrice, slippage, status: 'filled', filled_at: new Date().toISOString() });
        if (existing) {
          const newQty = existing.qty + qty;
          const newAvg = ((existing.qty * existing.avg_price) + (qty * fillPrice)) / newQty;
          db._conn.prepare('UPDATE paper_positions SET qty = ?, avg_price = ? WHERE user_id = ? AND symbol = ?').run(newQty, newAvg, UID, symbol);
        } else {
          db._conn.prepare('INSERT INTO paper_positions (user_id, symbol, qty, avg_price) VALUES (?, ?, ?, ?)').run(UID, symbol, qty, fillPrice);
        }
        db.paper.setState({ user_id: UID, tier: state.tier, cash: Number(state.cash || 0) - notional, initial_capital: state.initial_capital, realized_pnl: Number(state.realized_pnl || 0) });
        _audit('paper.adapter.filled', { uid: UID, orderId, symbol, side, qty, fillPrice });
        return { id: orderId, status: 'filled', fillPrice, side, qty, symbol };
      }

      // SELL — long-only close. Cap at held qty; reject if nothing held.
      const heldQty = existing ? Number(existing.qty || 0) : 0;
      if (heldQty <= 0) {
        _record(db, { user_id: UID, client_order_id: orderId, strategy_tag: strategy,
          symbol, side, qty, order_type: 'MARKET', product: 'CNC',
          req_price: ltp, fill_price: fillPrice, slippage, status: 'cancelled', filled_at: null });
        _audit('paper.adapter.cancelled', { uid: UID, orderId, symbol, reason: 'no_position' });
        return { id: orderId, status: 'cancelled', reason: 'no_position' };
      }
      const sellQty = Math.min(heldQty, qty);
      const notional = fillPrice * sellQty;
      _record(db, { user_id: UID, client_order_id: orderId, strategy_tag: strategy,
        symbol, side, qty: sellQty, order_type: 'MARKET', product: 'CNC',
        req_price: ltp, fill_price: fillPrice, slippage, status: 'filled', filled_at: new Date().toISOString() });
      const realized = (fillPrice - existing.avg_price) * sellQty;
      const remaining = heldQty - sellQty;
      if (remaining === 0) {
        db._conn.prepare('DELETE FROM paper_positions WHERE user_id = ? AND symbol = ?').run(UID, symbol);
      } else {
        db._conn.prepare('UPDATE paper_positions SET qty = ? WHERE user_id = ? AND symbol = ?').run(remaining, UID, symbol);
      }
      db._conn.prepare('INSERT INTO paper_closed_trades (user_id, symbol, side, qty, entry_price, exit_price, pnl, strategy_tag, entered_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(UID, symbol, 'BUY', sellQty, existing.avg_price, fillPrice, realized, strategy, existing.opened_at || new Date().toISOString());
      db.paper.setState({ user_id: UID, tier: state.tier, cash: Number(state.cash || 0) + notional, initial_capital: state.initial_capital, realized_pnl: Number(state.realized_pnl || 0) + realized });
      _audit('paper.adapter.filled', { uid: UID, orderId, symbol, side, qty: sellQty, fillPrice, realized: +realized.toFixed(2) });
      return { id: orderId, status: 'filled', fillPrice, side, qty: sellQty, symbol, realizedPnl: +realized.toFixed(2) };
    },
  };
}

module.exports = { createPaperAdapter };

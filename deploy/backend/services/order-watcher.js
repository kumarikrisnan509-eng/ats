// order-watcher.js -- T-512 (Phase 4 part 2): poll broker for live order
// status transitions; persist every change to live_order_updates.
//
// Today the system "fires and forgets" -- broker.placeOrder returns whatever
// Kite returned synchronously and that's the last word. Real life:
//   - Order goes pending at Kite, fills 5s later (status: COMPLETE)
//   - Order is partially filled (filled_quantity < quantity)
//   - Order is rejected at the exchange (status: REJECTED + reason)
//   - Order is cancelled by the broker (margin shortfall, etc.)
// All of these happen AFTER the synchronous response.
//
// This watcher polls broker.getOrders() once per minute during market hours,
// diffs against the last-seen status per order_id, and writes one row per
// transition to live_order_updates. Telegrams every REJECTED + every
// partial fill.
//
// Simpler than subscribing to Kite WS order-update postbacks (which would
// be lower-latency but requires receiving callbacks at a public URL).
// Polling is fine for typical autorun cadence.

'use strict';

const POLL_INTERVAL_MS = 60 * 1000;

function createOrderWatcher({ db, getBroker, getMarketMeta, notify, audit }) {
  if (!db || !db._conn) throw new Error('createOrderWatcher: db required');
  const _audit = audit || (() => {});
  const _notify = notify || null;
  const conn = db._conn;
  let _timer = null;
  // last-seen status per order_id, in-memory (persisted indirectly by the
  // table itself -- on restart we don't replay, just resume from "current").
  const _lastStatus = new Map();

  // Schema bootstrap.
  conn.exec(`
    CREATE TABLE IF NOT EXISTS live_order_updates (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id        TEXT NOT NULL,
      status          TEXT NOT NULL,
      filled_quantity INTEGER,
      quantity        INTEGER,
      average_price   REAL,
      status_message  TEXT,
      ts              TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_lou_order ON live_order_updates(order_id, ts);
  `);
  const insert = conn.prepare(
    'INSERT INTO live_order_updates (order_id, status, filled_quantity, quantity, average_price, status_message) VALUES (?, ?, ?, ?, ?, ?)'
  );

  async function _tick() {
    try {
      const mm = (typeof getMarketMeta === 'function') ? getMarketMeta() : null;
      if (mm && typeof mm.isMarketOpenNow === 'function') {
        const st = mm.isMarketOpenNow();
        if (st && st.open === false) return;   // off-hours: nothing to poll
      }
      const broker = (typeof getBroker === 'function') ? getBroker() : null;
      if (!broker) return;
      let orders = [];
      try {
        if (typeof broker.getOrders === 'function')      orders = await broker.getOrders();
        else if (typeof broker.orders === 'function')    orders = await broker.orders();
      } catch (e) {
        _audit('orderWatcher.fetch.failed', { msg: e.message });
        return;
      }
      if (!Array.isArray(orders)) return;
      for (const o of orders) {
        const oid    = o.order_id || o.orderId;
        if (!oid) continue;
        const status = o.status || 'UNKNOWN';
        const prev   = _lastStatus.get(oid);
        if (prev === status) continue;   // no change
        _lastStatus.set(oid, status);
        const fq = Number(o.filled_quantity != null ? o.filled_quantity : o.filledQuantity) || 0;
        const q  = Number(o.quantity        != null ? o.quantity        : o.qty)            || 0;
        try {
          insert.run(oid, status, fq, q, Number(o.average_price || o.averagePrice || 0) || null, o.status_message || o.statusMessage || null);
          _audit('orderWatcher.transition', { order_id: oid, from: prev || null, to: status, filled: fq, qty: q });
        } catch (e) { _audit('orderWatcher.insert.failed', { msg: e.message, order_id: oid }); }

        if (_notify && typeof _notify.notify === 'function') {
          if (status === 'REJECTED') {
            _notify.notify({
              title: '❌ Order REJECTED',
              body: `order ${oid}: ${o.status_message || o.statusMessage || '(no reason)'}`,
            }).catch(() => {});
          } else if (status === 'COMPLETE' && fq > 0 && q > 0 && fq < q) {
            _notify.notify({
              title: '⚠️ Partial fill',
              body: `order ${oid}: filled ${fq}/${q} @ ${o.average_price || '?'}`,
            }).catch(() => {});
          }
        }
      }
    } catch (e) {
      _audit('orderWatcher.tick.failed', { msg: e.message });
    }
  }

  function start() {
    if (_timer) return;
    _timer = setInterval(_tick, POLL_INTERVAL_MS);
    if (typeof _timer.unref === 'function') _timer.unref();
    _audit('orderWatcher.started', { pollIntervalMs: POLL_INTERVAL_MS });
  }
  function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }
  function getRecentUpdates(orderId, limit = 25) {
    return conn.prepare('SELECT id, order_id, status, filled_quantity, quantity, average_price, status_message, ts FROM live_order_updates WHERE order_id = ? ORDER BY id DESC LIMIT ?').all(orderId, limit);
  }

  return { start, stop, runNow: _tick, getRecentUpdates };
}

module.exports = { createOrderWatcher };

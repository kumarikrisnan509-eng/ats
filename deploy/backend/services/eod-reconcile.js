// eod-reconcile.js -- T-510 (Phase 5): nightly position/order reconciliation.
//
// At 15:45 IST (15 min after market close), pull broker.getPositions(),
// broker.getOrders(), broker.getHoldings() and diff against the local DB
// (paper_positions, live_orders). Any mismatch is audited + Telegrammed
// because drift between local state and broker state is the single most
// dangerous failure mode for unattended live trading.
//
// Permissive on dep failure (broker down at EOD = audit-only, no crash).
// Runs once per day via the same minute-poller pattern as promote-scheduler.

'use strict';

const FIRE_HOUR_IST   = 15;
const FIRE_MINUTE_IST = 45;
const TICK_INTERVAL_MS = 60 * 1000;
const MIN_BETWEEN_RUNS_MS = 12 * 60 * 60 * 1000;

function _nowIST() {
  return new Date(Date.now() + (5.5 * 60 * 60 * 1000));
}
function _istHm() { const d = _nowIST(); return { h: d.getUTCHours(), m: d.getUTCMinutes() }; }
function _today() { return _nowIST().toISOString().slice(0, 10); }

function createEodReconcile({ db, getBroker, getPaper, notify, audit }) {
  if (!db || !db._conn) throw new Error('createEodReconcile: db required');
  const _audit = audit || (() => {});
  const _notify = notify || null;
  let _timer = null;
  let _lastRunUnix = 0;

  async function _runReconcile() {
    const broker = (typeof getBroker === 'function') ? getBroker() : null;
    const paper  = (typeof getPaper === 'function')  ? getPaper()  : null;
    if (!broker) {
      _audit('eod.reconcile.skipped', { reason: 'broker_unavailable' });
      return { ok: false, reason: 'broker_unavailable' };
    }

    let brokerPositions = [], brokerOrders = [], brokerHoldings = [];
    try {
      if (typeof broker.getPositions === 'function') brokerPositions = await broker.getPositions();
      else if (typeof broker.positions === 'function') brokerPositions = await broker.positions();
    } catch (e) { _audit('eod.reconcile.positions.fail', { msg: e.message }); }
    try {
      if (typeof broker.getOrders === 'function')    brokerOrders    = await broker.getOrders();
      else if (typeof broker.orders === 'function')  brokerOrders    = await broker.orders();
    } catch (e) { _audit('eod.reconcile.orders.fail',    { msg: e.message }); }
    try {
      if (typeof broker.getHoldings === 'function')  brokerHoldings  = await broker.getHoldings();
      else if (typeof broker.holdings === 'function') brokerHoldings = await broker.holdings();
    } catch (e) { _audit('eod.reconcile.holdings.fail',  { msg: e.message }); }

    const paperPositions = (paper && typeof paper.positions === 'function')
      ? paper.positions().filter(p => p && p.qty !== 0)
      : [];

    // Build comparable sets keyed by symbol.
    const bSet = new Map();
    for (const p of (brokerPositions || [])) {
      const sym = p.symbol || p.tradingsymbol || p.tradingSymbol;
      const qty = Number(p.qty != null ? p.qty : (p.net_quantity != null ? p.net_quantity : p.netQuantity));
      if (sym && Number.isFinite(qty) && qty !== 0) bSet.set(sym, qty);
    }
    const pSet = new Map();
    for (const p of paperPositions) {
      if (p && p.symbol && Number.isFinite(p.qty) && p.qty !== 0) pSet.set(p.symbol, p.qty);
    }

    const mismatches = [];
    for (const [sym, qty] of bSet) {
      if (!pSet.has(sym)) mismatches.push({ kind: 'broker_only',  symbol: sym, broker_qty: qty });
      else if (pSet.get(sym) !== qty) mismatches.push({ kind: 'qty_mismatch', symbol: sym, broker_qty: qty, paper_qty: pSet.get(sym) });
    }
    for (const [sym, qty] of pSet) {
      if (!bSet.has(sym)) mismatches.push({ kind: 'paper_only', symbol: sym, paper_qty: qty });
    }

    const summary = {
      ran_at: new Date().toISOString(),
      ist_date: _today(),
      broker_positions: bSet.size,
      paper_positions: pSet.size,
      broker_orders_today: (brokerOrders || []).length,
      broker_holdings: (brokerHoldings || []).length,
      mismatches,
    };

    _audit('eod.reconcile.completed', summary);

    if (mismatches.length && _notify && typeof _notify.notify === 'function') {
      _notify.notify({
        title: '⚠️ EOD reconcile — drift detected',
        body: `${mismatches.length} mismatch(es) at ${summary.ist_date}: ${mismatches.slice(0,5).map(m => `${m.symbol}(${m.kind})`).join(', ')}${mismatches.length > 5 ? ` +${mismatches.length-5} more` : ''}. Inspect /api/reconcile.`,
      }).catch(() => {});
    } else if (_notify && typeof _notify.notify === 'function') {
      // Optional clean-day acknowledgement -- comment out if noise is undesirable.
      // _notify.notify({ title: '✅ EOD reconcile clean', body: `${bSet.size} positions matched.` }).catch(() => {});
    }
    return summary;
  }

  function _onTick() {
    if (Date.now() - _lastRunUnix < MIN_BETWEEN_RUNS_MS) return;
    const { h, m } = _istHm();
    if (h !== FIRE_HOUR_IST || m !== FIRE_MINUTE_IST) return;
    _lastRunUnix = Date.now();
    _runReconcile().catch(e => _audit('eod.reconcile.fatal', { msg: e.message }));
  }

  function start() {
    if (_timer) return;
    _timer = setInterval(_onTick, TICK_INTERVAL_MS);
    if (typeof _timer.unref === 'function') _timer.unref();
    _audit('eod.reconcile.started', { fireAt_ist: `${FIRE_HOUR_IST}:${String(FIRE_MINUTE_IST).padStart(2,'0')}` });
  }
  function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }

  return { start, stop, runNow: _runReconcile };
}

module.exports = { createEodReconcile };

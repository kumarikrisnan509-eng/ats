// disconnect-watchdog.js -- T-504 (P1 #12): auto-flatten on extended broker
// disconnect during market hours.
//
// The KILL_SWITCH + soft-kill block NEW orders. T-498 panic-square-off
// flattens on demand. This service automates the panic case: if the broker
// stays disconnected for N minutes while the market is open AND there are
// open positions, the watchdog engages soft-kill and squares off the book
// without operator input.
//
// OFF BY DEFAULT. To enable:
//     ATS_DISCONNECT_AUTOSQUARE_ENABLED=true
//     ATS_DISCONNECT_AUTOSQUARE_MIN=5   (minutes; default 5)
//
// The conservative defaults are deliberate: a knee-jerk auto-flatten on a
// 30-second network blip would be worse than the disconnect itself. Five
// minutes during market hours is long enough that the broker is genuinely
// down, not just hiccuping.
//
// Trigger conditions (ALL must hold):
//   1. ATS_DISCONNECT_AUTOSQUARE_ENABLED=true in env
//   2. Market is currently open (marketMeta.isMarketOpenNow().open)
//   3. Broker is disconnected (broker.health().connected === false)
//   4. Disconnected duration > ATS_DISCONNECT_AUTOSQUARE_MIN minutes
//   5. There are non-zero open positions to flatten
//
// On trigger: engages soft-kill (so autorun can't re-enter), pulls
// positions, places reverse MARKET orders, fires Telegram. Once flattened,
// the watchdog disarms until the broker reconnects + the operator clears
// soft-kill -- prevents a thrashing loop.

'use strict';

const softKill = require('./soft-kill');

const TICK_INTERVAL_MS = 60 * 1000;
const DEFAULT_TRIGGER_MIN = 5;

function createDisconnectWatchdog({ getBroker, getMarketMeta, notify, audit }) {
  const _audit = audit || (() => {});
  const _notify = notify || null;
  let _timer = null;
  let _disconnectedSince = 0;   // unix ms when we first observed connected=false during market hours; 0 = not currently disconnected
  let _lastTriggerAt = 0;       // dedupe: don't re-fire within an hour
  const TRIGGER_DEDUPE_MS = 60 * 60 * 1000;

  function _enabled() { return String(process.env.ATS_DISCONNECT_AUTOSQUARE_ENABLED || '').toLowerCase() === 'true'; }
  function _triggerMin() {
    const n = parseInt(process.env.ATS_DISCONNECT_AUTOSQUARE_MIN || DEFAULT_TRIGGER_MIN, 10);
    return (Number.isFinite(n) && n > 0) ? n : DEFAULT_TRIGGER_MIN;
  }

  async function _squareOffNow(reason) {
    const broker = (typeof getBroker === 'function') ? getBroker() : null;
    if (!broker || typeof broker.placeOrder !== 'function') {
      _audit('watchdog.squareOff.skipped', { reason: 'broker_unavailable' });
      return;
    }
    // Engage soft-kill FIRST so autorun stops re-entering.
    try {
      softKill.set({ reason: 'disconnect_watchdog:' + reason, by: 'watchdog', at: new Date().toISOString() });
    } catch (e) { _audit('watchdog.softKill.failed', { msg: e.message }); }

    let positions = [];
    try {
      if (typeof broker.getPositions === 'function')      positions = await broker.getPositions();
      else if (typeof broker.positions === 'function')    positions = await broker.positions();
    } catch (e) {
      _audit('watchdog.positions.fetch.failed', { msg: e.message });
      if (_notify && typeof _notify.notify === 'function') {
        _notify.notify({ title: '🚨 ATS watchdog: cannot fetch positions', body: `Broker disconnected; position fetch failed: ${e.message}. Soft-kill engaged. Manual intervention required.` }).catch(() => {});
      }
      return;
    }
    const flat = (Array.isArray(positions) ? positions : [])
      .map(p => ({
        symbol:   p.symbol || p.tradingsymbol || p.tradingSymbol,
        qty:      Number(p.qty != null ? p.qty : (p.net_quantity != null ? p.net_quantity : p.netQuantity)),
        exchange: p.exchange || 'NSE',
        product:  p.product || 'MIS',
      }))
      .filter(p => p.symbol && Number.isFinite(p.qty) && p.qty !== 0);

    if (!flat.length) {
      _audit('watchdog.squareOff.noop', { reason: 'no_open_positions' });
      if (_notify && typeof _notify.notify === 'function') {
        _notify.notify({ title: '🚨 ATS watchdog: broker disconnected', body: `Broker disconnected ${_triggerMin()}m+ during market hours. No open positions to flatten. Soft-kill engaged; clear via /api/admin/soft-kill-reset.` }).catch(() => {});
      }
      return;
    }

    const results = [];
    for (const p of flat) {
      const side = p.qty > 0 ? 'SELL' : 'BUY';
      const qty  = Math.abs(p.qty);
      try {
        const r = await broker.placeOrder({ symbol: p.symbol, exchange: p.exchange, side, qty, orderType: 'MARKET', product: p.product, tag: 'watchdog_autosquare' });
        results.push({ symbol: p.symbol, side, qty, ok: true, broker_order_id: r && (r.order_id || r.orderId) });
      } catch (e) {
        results.push({ symbol: p.symbol, side, qty, ok: false, error: e.message });
      }
    }
    const summary = {
      reason, requested_at: new Date().toISOString(),
      total: flat.length,
      squared: results.filter(r => r.ok).length,
      failed:  results.filter(r => !r.ok).length,
    };
    _audit('watchdog.squareOff.fired', { summary, results });
    if (_notify && typeof _notify.notify === 'function') {
      _notify.notify({
        title: '🚨 ATS watchdog: auto-square fired',
        body: `Broker disconnected ${_triggerMin()}m+ during market hours. ${summary.squared}/${summary.total} positions squared (${summary.failed} failed). Soft-kill engaged.`,
      }).catch(() => {});
    }
  }

  async function _onTick() {
    if (!_enabled()) return;
    try {
      const broker = (typeof getBroker === 'function') ? getBroker() : null;
      const mm     = (typeof getMarketMeta === 'function') ? getMarketMeta() : null;
      if (!broker || !mm || typeof mm.isMarketOpenNow !== 'function') return;
      const mkt = mm.isMarketOpenNow();
      if (!mkt || mkt.open === false) {
        // Market closed -- reset the disconnect timer so the count starts
        // fresh tomorrow during market hours.
        _disconnectedSince = 0;
        return;
      }
      const bh = (typeof broker.health === 'function') ? broker.health() : { connected: false };
      const isConnected = !!(bh && bh.connected);
      if (isConnected) {
        if (_disconnectedSince) {
          _audit('watchdog.recovered', { wasDownForMs: Date.now() - _disconnectedSince });
        }
        _disconnectedSince = 0;
        return;
      }
      // We're disconnected during market hours.
      if (!_disconnectedSince) {
        _disconnectedSince = Date.now();
        _audit('watchdog.disconnect.start', { at: new Date().toISOString() });
      }
      const downMin = (Date.now() - _disconnectedSince) / 60000;
      if (downMin < _triggerMin()) return;
      if ((Date.now() - _lastTriggerAt) < TRIGGER_DEDUPE_MS) return;
      _lastTriggerAt = Date.now();
      await _squareOffNow(`broker_disconnected_${Math.round(downMin)}min`);
    } catch (e) {
      _audit('watchdog.tick.failed', { msg: e.message });
    }
  }

  function start() {
    if (_timer) return;
    _timer = setInterval(_onTick, TICK_INTERVAL_MS);
    if (typeof _timer.unref === 'function') _timer.unref();
    _audit('watchdog.started', { enabled: _enabled(), triggerMin: _triggerMin() });
  }
  function stop() { if (_timer) { clearInterval(_timer); _timer = null; } }
  function status() {
    return {
      enabled: _enabled(),
      triggerMin: _triggerMin(),
      disconnectedSince: _disconnectedSince || null,
      lastTriggerAt: _lastTriggerAt || null,
    };
  }

  return { start, stop, status, _squareOffNow };
}

module.exports = { createDisconnectWatchdog };

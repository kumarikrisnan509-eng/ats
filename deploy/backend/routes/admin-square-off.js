// admin-square-off.js -- T-496 (audit-2026-05-28): panic-square-off endpoint.
//
// The kill switch (KILL_SWITCH env + soft-kill) only blocks NEW orders.
// Existing live broker positions sit untouched until the operator manually
// flattens them via the Kite web UI. That's a real production gap: if
// anything goes wrong intraday the operator cannot exit their book from
// their own UI.
//
// This route fixes that. POST /api/admin/square-off-all walks every open
// position from broker.getPositions(), places a MARKET order in the
// opposite direction for abs(qty), and returns a per-symbol report.
// Also fires soft-kill so the autorun/scanner stack does not re-enter
// while square-off is in flight.
//
// Confirmation: the caller MUST send body { confirm: 'SQUARE-OFF-ALL' }.
// This is deliberately strict because the endpoint cannot be undone.
//
// Auth: req.user required (mounted under cookie-session middleware).
// Audit: every action emits 'square-off.*' events into the WORM audit chain.

'use strict';

const softKill = require('../services/soft-kill');

function mountAdminSquareOffRoutes(app, deps) {
  const {
    getBroker,
    getMarketMeta,
    notify,
    audit,
  } = deps;

  const _audit = audit || (() => {});

  app.post('/api/admin/square-off-all', async (req, res) => {
    if (!req.user) {
      return res.status(401).json({ ok: false, reason: 'auth_required' });
    }
    const body = req.body || {};
    if (body.confirm !== 'SQUARE-OFF-ALL') {
      return res.status(400).json({
        ok: false,
        reason: 'confirmation_required',
        message: "Pass body { confirm: 'SQUARE-OFF-ALL' } exactly. This action cannot be undone.",
      });
    }

    const broker = (typeof getBroker === 'function') ? getBroker() : null;
    if (!broker || typeof broker.placeOrder !== 'function') {
      return res.status(503).json({ ok: false, reason: 'broker_unavailable' });
    }

    // Fire soft-kill FIRST so the autorun + scanner stack stops re-entering.
    // The operator can clear it via the existing /api/admin/soft-kill-reset.
    try {
      softKill.set({
        reason: 'square_off_all',
        by: req.user.email || req.user.id || 'unknown',
        at: new Date().toISOString(),
      });
      _audit('square-off.softKill.set', { userId: req.user.id, email: req.user.email });
    } catch (e) {
      _audit('square-off.softKill.failed', { msg: e.message });
    }

    // Pull positions. Different brokers expose this differently; we accept
    // either getPositions() -> array, or .positions(). Each position should
    // have { symbol, qty, exchange?, product? }.
    let positions = [];
    try {
      if (typeof broker.getPositions === 'function') {
        positions = await broker.getPositions();
      } else if (typeof broker.positions === 'function') {
        positions = await broker.positions();
      }
    } catch (e) {
      _audit('square-off.positions.fetch.failed', { msg: e.message });
      return res.status(502).json({
        ok: false,
        reason: 'positions_fetch_failed',
        message: `Could not fetch positions from broker: ${e.message}. Soft-kill is engaged; clear via /api/admin/soft-kill-reset once you've squared off manually.`,
      });
    }
    if (!Array.isArray(positions)) positions = [];

    const flat = positions
      .map(p => ({
        symbol:   p.symbol || p.tradingsymbol || p.tradingSymbol,
        qty:      Number(p.qty != null ? p.qty : (p.net_quantity != null ? p.net_quantity : p.netQuantity)),
        exchange: p.exchange || 'NSE',
        product:  p.product || 'MIS',
      }))
      .filter(p => p.symbol && Number.isFinite(p.qty) && p.qty !== 0);

    const results = [];
    for (const p of flat) {
      const side = p.qty > 0 ? 'SELL' : 'BUY';
      const qty  = Math.abs(p.qty);
      const payload = {
        symbol:    p.symbol,
        exchange:  p.exchange,
        side,
        qty,
        orderType: 'MARKET',
        product:   p.product,
        tag:       'square_off_all',
      };
      try {
        const r = await broker.placeOrder(payload);
        _audit('square-off.placed', { userId: req.user.id, payload, result: r });
        results.push({ symbol: p.symbol, side, qty, ok: true, broker_order_id: r && (r.order_id || r.orderId) });
      } catch (e) {
        _audit('square-off.failed', { userId: req.user.id, payload, msg: e.message });
        results.push({ symbol: p.symbol, side, qty, ok: false, error: e.message });
      }
    }

    const summary = {
      ok: true,
      requested_at: new Date().toISOString(),
      total_positions: flat.length,
      squared:  results.filter(r => r.ok).length,
      failed:   results.filter(r => !r.ok).length,
      results,
      soft_kill_engaged: true,
      note: "Soft-kill is now engaged so autorun won't re-enter. Use POST /api/admin/soft-kill-reset to resume trading once positions are flat.",
    };

    // Best-effort Telegram heads-up.
    try {
      if (notify && typeof notify.notify === 'function') {
        await notify.notify({
          title: '🚨 Square-off-all triggered',
          body: `${summary.squared}/${summary.total_positions} positions squared (${summary.failed} failed). Soft-kill is engaged.`,
        });
      }
    } catch { /* best-effort */ }

    return res.json(summary);
  });

  // Dry-run / preview — what WOULD be squared off, without firing any orders.
  app.get('/api/admin/square-off-all/preview', async (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const broker = (typeof getBroker === 'function') ? getBroker() : null;
    if (!broker) return res.status(503).json({ ok: false, reason: 'broker_unavailable' });
    let positions = [];
    try {
      if (typeof broker.getPositions === 'function')      positions = await broker.getPositions();
      else if (typeof broker.positions === 'function')    positions = await broker.positions();
    } catch (e) { return res.status(502).json({ ok: false, reason: 'positions_fetch_failed', msg: e.message }); }
    const plan = (Array.isArray(positions) ? positions : [])
      .map(p => ({
        symbol:   p.symbol || p.tradingsymbol || p.tradingSymbol,
        qty:      Number(p.qty != null ? p.qty : (p.net_quantity != null ? p.net_quantity : p.netQuantity)),
        exchange: p.exchange || 'NSE',
      }))
      .filter(p => p.symbol && Number.isFinite(p.qty) && p.qty !== 0)
      .map(p => ({ symbol: p.symbol, exchange: p.exchange, side: p.qty > 0 ? 'SELL' : 'BUY', qty: Math.abs(p.qty) }));
    res.json({ ok: true, total: plan.length, plan });
  });
}

module.exports = { mountAdminSquareOffRoutes };

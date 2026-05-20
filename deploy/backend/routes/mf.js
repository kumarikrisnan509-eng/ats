// T-241 (Kite Connect MF — read-side only):
// Mutual-fund endpoints backed by Kite Connect's MF API.
//
// Kite Connect MF is GET-only by design — placement (BUY/REDEEM/SIP-create)
// can't be done over the API because Coin requires bank-account payment that
// the API doesn't broker. So we surface only what's actually available:
//   - GET /api/me/mf/holdings      (kc.getMFHoldings)
//   - GET /api/me/mf/sips          (kc.getMFSIPs)
//   - GET /api/me/mf/orders        (kc.getMFOrders, last 7 days)
//   - GET /api/me/mf/instruments   (kc.getMFInstruments, ~16k Coin schemes)
//
// For NON-Zerodha brokers (Dhan, Angel, Upstox, Mock), MF endpoints return
// empty with a `notSupported` reason so the UI can render a clean
// "your broker doesn't expose MF via API" empty state.

'use strict';

// Cache the instrument master in memory for 24h. It changes infrequently
// (new fund launches + dividend adjustments only) and ~16k rows is ~3 MB.
const INSTRUMENTS_TTL_MS = 24 * 60 * 60 * 1000;
let _instrumentsCache = { data: null, fetchedAt: 0 };

function mountMfRoutes(app, deps) {
  const { resolveUserBroker, audit } = deps;

  // Helper: get the user's broker + only proceed if it has MF support
  // (i.e. exposes getMFHoldings). All other brokers will get an empty
  // response with a clear reason string.
  const requireMfBroker = async (req) => {
    const r = await resolveUserBroker(req);
    if (!r.broker) return { ok: false, reason: r.reason || 'no_broker_connected' };
    if (typeof r.broker.getMFHoldings !== 'function') {
      return { ok: false, reason: 'broker_does_not_support_mf', brokerName: r.broker.name };
    }
    return { ok: true, broker: r.broker };
  };

  app.get('/api/me/mf/holdings', async (req, res) => {
    try {
      const r = await requireMfBroker(req);
      if (!r.ok) return res.json({ ok: true, brokerConnected: false, reason: r.reason, holdings: [] });
      const holdings = await r.broker.getMFHoldings();
      // Compute aggregates the UI commonly needs
      const totals = (holdings || []).reduce((a, h) => {
        const cost  = (h.quantity || 0) * (h.avgPrice || 0);
        const value = (h.quantity || 0) * (h.nav      || 0);
        a.invested += cost;
        a.current  += value;
        a.pnl      += (value - cost);
        return a;
      }, { invested: 0, current: 0, pnl: 0 });
      res.json({ ok: true, brokerConnected: true, holdings, totals, source: 'zerodha_kite_mf' });
    } catch (e) {
      audit && audit('mf.holdings.error', { msg: e.message });
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  app.get('/api/me/mf/sips', async (req, res) => {
    try {
      const r = await requireMfBroker(req);
      if (!r.ok) return res.json({ ok: true, brokerConnected: false, reason: r.reason, sips: [] });
      const sips = await r.broker.getMFSIPs();
      const active = (sips || []).filter(s => s.status === 'ACTIVE');
      const monthlyOutlay = active.reduce((a, s) => {
        if (s.frequency === 'monthly')   return a + (s.instalmentAmount || 0);
        if (s.frequency === 'weekly')    return a + (s.instalmentAmount || 0) * 4.345;   // approx
        if (s.frequency === 'quarterly') return a + (s.instalmentAmount || 0) / 3;
        return a;
      }, 0);
      res.json({
        ok: true, brokerConnected: true, sips,
        summary: {
          total:         sips.length,
          active:        active.length,
          paused:        sips.filter(s => s.status === 'PAUSED').length,
          cancelled:     sips.filter(s => s.status === 'CANCELLED').length,
          monthlyOutlay: Math.round(monthlyOutlay),
        },
        source: 'zerodha_kite_mf',
      });
    } catch (e) {
      audit && audit('mf.sips.error', { msg: e.message });
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  app.get('/api/me/mf/orders', async (req, res) => {
    try {
      const r = await requireMfBroker(req);
      if (!r.ok) return res.json({ ok: true, brokerConnected: false, reason: r.reason, orders: [] });
      const orders = await r.broker.getMFOrders();
      const byStatus = (orders || []).reduce((a, o) => {
        a[o.status] = (a[o.status] || 0) + 1; return a;
      }, {});
      res.json({ ok: true, brokerConnected: true, orders, byStatus, source: 'zerodha_kite_mf' });
    } catch (e) {
      audit && audit('mf.orders.error', { msg: e.message });
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  app.get('/api/me/mf/instruments', async (req, res) => {
    try {
      // Optional query: ?q=parag&limit=20  filters the cached master by name/AMC/ISIN.
      const q = (req.query.q || '').toString().trim().toLowerCase();
      const limit = Math.min(parseInt(req.query.limit) || 50, 500);

      // Check cache
      const now = Date.now();
      let rows = _instrumentsCache.data;
      let cacheAgeMs = now - _instrumentsCache.fetchedAt;
      if (!rows || cacheAgeMs > INSTRUMENTS_TTL_MS) {
        const r = await requireMfBroker(req);
        if (!r.ok) return res.json({ ok: true, brokerConnected: false, reason: r.reason, instruments: [] });
        rows = await r.broker.getMFInstruments();
        _instrumentsCache = { data: rows, fetchedAt: now };
        cacheAgeMs = 0;
      }

      // Filter
      let filtered = rows;
      if (q) {
        filtered = rows.filter(r => {
          const hay = ((r.name || '') + ' ' + (r.amc || '') + ' ' + (r.isin || '')).toLowerCase();
          return hay.includes(q);
        });
      }
      // Only purchase-allowed direct-plan growth options by default
      // unless ?all=1
      if (req.query.all !== '1') {
        filtered = filtered.filter(r => r.purchaseAllowed && r.plan === 'direct');
      }
      filtered = filtered.slice(0, limit);

      res.json({
        ok: true,
        instruments: filtered,
        totalInMaster: rows.length,
        filteredCount: filtered.length,
        cacheAgeSec: Math.round(cacheAgeMs / 1000),
        source: 'zerodha_kite_mf',
      });
    } catch (e) {
      audit && audit('mf.instruments.error', { msg: e.message });
      res.status(500).json({ ok: false, reason: e.message });
    }
  });
}

module.exports = { mountMfRoutes };

// legacy-paper.js -- T-405 (architecture audit #1, server.js split #30).
//
// Pre-Tier 75 unscoped paper-trading routes. These are SOFT-DEPRECATED in
// favour of /api/me/paper (which is per-user); they stay for back-compat
// until clients confirm migration. All wrapped in withDeprecation so:
//   (1) anon callers get 401 (no read-leak),
//   (2) response carries `Deprecation: true` + Link header,
//   (3) every hit is audited as `legacy.route.hit`.
//
// Eight routes:
//   - GET    /api/paper             -- stats only (NOT deprecated; pulls from
//                                       singleton paper.stats(), used by both
//                                       legacy and current dashboards)
//   - GET    /api/paper/orders      DEPRECATED
//   - GET    /api/paper/positions   DEPRECATED
//   - GET    /api/paper/trades      DEPRECATED
//   - GET    /api/paper/tiers       DEPRECATED
//   - POST   /api/paper/order       DEPRECATED
//   - DELETE /api/paper/order/:id   DEPRECATED
//   - POST   /api/paper/reset       DEPRECATED
//
// Public API
// ==========
//   mountLegacyPaperRoutes(app, { getPaper, withDeprecation });

'use strict';

function mountLegacyPaperRoutes(app, deps) {
  const { getPaper, withDeprecation } = deps;
  if (typeof getPaper         !== 'function') throw new Error('legacy-paper: getPaper required');
  if (typeof withDeprecation  !== 'function') throw new Error('legacy-paper: withDeprecation required');

  // T-536: When the request is from an authenticated user, return THAT
  // user's per-user paper stats (computed from db.paper). Falls back to
  // the legacy global-singleton stats for unauthenticated/probe callers.
  // This makes the LIVE PAPER ACCOUNT bar in the UI show consistent data
  // with the virtual-account selector (both now Engine B).
  app.get('/api/paper', (req, res) => {
    const paper = getPaper();
    const getDb = deps.getDb;
    if (req.user && req.user.id && typeof getDb === 'function') {
      try {
        const db = getDb();
        const uid = req.user.id;
        const state     = db.paper.getState(uid);
        const orders    = db.paper.listOrders(uid);
        const positions = db.paper.listPositions(uid);
        const trades    = db._conn.prepare('SELECT * FROM paper_closed_trades WHERE user_id = ? ORDER BY exited_at DESC LIMIT 200').all(uid);

        const filledOrders = orders.filter(o => String(o.status||'').toUpperCase() === 'FILLED').length;
        const closedTrades = trades.length;
        const wins         = trades.filter(t => Number(t.pnl) > 0).length;
        const realizedPnl  = trades.reduce((s, t) => s + Number(t.pnl||0), 0);
        const positionsValue = positions.reduce((s, p) => s + Number(p.avg_price||0) * Number(p.qty||0), 0);
        return res.json({ ok: true, stats: {
          cash:           Number(state.cash || 0),
          openPositions:  positions.length,
          totalOrders:    orders.length,
          filledOrders,
          pendingOrders:  orders.filter(o => ['PENDING','OPEN'].includes(String(o.status||'').toUpperCase())).length,
          cancelledOrders: orders.filter(o => String(o.status||'').toUpperCase() === 'CANCELLED').length,
          closedTrades,
          wins,
          losses: closedTrades - wins,
          winRate: closedTrades > 0 ? Math.round((wins / closedTrades) * 100) : 0,
          realizedPnl,
          unrealizedPnl: 0,
          totalEquity: Number(state.cash || 0) + positionsValue,
        }});
      } catch (e) { /* fall through to legacy below */ }
    }
    // Legacy fallback (anonymous probes, /api/health-deep etc.)
    if (!paper) return res.status(503).json({ ok: false, reason: 'paper_not_initialized' });
    res.json({ ok: true, stats: paper.stats() });
  });

  // The rest are auth-gated + Deprecation-tagged via withDeprecation('/api/me/paper', ...)
  app.get('/api/paper/orders', withDeprecation('/api/me/paper', (req, res) => {
    // T-536: per-user when authed (Engine B), legacy fallback otherwise.
    const getDb = deps.getDb;
    if (req.user && req.user.id && typeof getDb === 'function') {
      try { return res.json({ ok: true, orders: getDb().paper.listOrders(req.user.id) }); }
      catch (e) { /* fall through */ }
    }
    const paper = getPaper();
    if (!paper) return res.status(503).json({ ok: false, reason: 'paper_not_initialized' });
    res.json({ ok: true, orders: paper.list() });
  }));

  app.get('/api/paper/positions', withDeprecation('/api/me/paper', (req, res) => {
    // T-536: per-user when authed.
    const getDb = deps.getDb;
    if (req.user && req.user.id && typeof getDb === 'function') {
      try { return res.json({ ok: true, positions: getDb().paper.listPositions(req.user.id) }); }
      catch (e) { /* fall through */ }
    }
    const paper = getPaper();
    if (!paper) return res.status(503).json({ ok: false, reason: 'paper_not_initialized' });
    res.json({ ok: true, positions: paper.positions() });
  }));

  app.get('/api/paper/trades', withDeprecation('/api/me/paper', (req, res) => {
    // T-536: per-user when authed.
    const lim = parseInt(req.query.limit || '50', 10) || 50;
    const getDb = deps.getDb;
    if (req.user && req.user.id && typeof getDb === 'function') {
      try {
        const db = getDb();
        const rows = db._conn.prepare('SELECT * FROM paper_closed_trades WHERE user_id = ? ORDER BY exited_at DESC LIMIT ?').all(req.user.id, lim);
        return res.json({ ok: true, trades: rows });
      } catch (e) { /* fall through */ }
    }
    const paper = getPaper();
    if (!paper) return res.status(503).json({ ok: false, reason: 'paper_not_initialized' });
    res.json({ ok: true, trades: paper.trades(lim) });
  }));

  app.post('/api/paper/order', withDeprecation('/api/me/paper', (req, res) => {
    const paper = getPaper();
    if (!paper) return res.status(503).json({ ok: false, reason: 'paper_not_initialized' });
    try {
      const o = paper.placeOrder(req.body || {});
      res.status(201).json({ ok: true, order: o });
    } catch (e) { res.status(400).json({ ok: false, reason: e.message }); }
  }));

  app.delete('/api/paper/order/:id', withDeprecation('/api/me/paper', (req, res) => {
    const paper = getPaper();
    if (!paper) return res.status(503).json({ ok: false, reason: 'paper_not_initialized' });
    res.json({ ok: true, ...paper.cancelOrder(req.params.id) });
  }));

  app.post('/api/paper/reset', withDeprecation('/api/me/paper', (req, res) => {
    const paper = getPaper();
    if (!paper) return res.status(503).json({ ok: false, reason: 'paper_not_initialized' });
    try {
      const r = paper.reset(req.body || {});
      res.json({ ok: true, ...r, stats: paper.stats() });
    } catch (e) { res.status(400).json({ ok: false, reason: e.message }); }
  }));

  // Tier 28: expose available paper tiers
  app.get('/api/paper/tiers', withDeprecation('/api/me/paper', (_req, res) => {
    const paper = getPaper();
    if (!paper) return res.status(503).json({ ok: false, reason: 'paper_not_initialized' });
    res.json({ ok: true, tiers: paper.availableTiers(), current: paper.stats().cash + paper.stats().totalEquity ? paper.stats() : null });
  }));
}

module.exports = { mountLegacyPaperRoutes };

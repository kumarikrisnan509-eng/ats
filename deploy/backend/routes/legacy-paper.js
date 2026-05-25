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

  // NOT deprecated (no wrapper) -- public stats endpoint
  app.get('/api/paper', (_req, res) => {
    const paper = getPaper();
    if (!paper) return res.status(503).json({ ok: false, reason: 'paper_not_initialized' });
    res.json({ ok: true, stats: paper.stats() });
  });

  // The rest are auth-gated + Deprecation-tagged via withDeprecation('/api/me/paper', ...)
  app.get('/api/paper/orders', withDeprecation('/api/me/paper', (_req, res) => {
    const paper = getPaper();
    if (!paper) return res.status(503).json({ ok: false, reason: 'paper_not_initialized' });
    res.json({ ok: true, orders: paper.list() });
  }));

  app.get('/api/paper/positions', withDeprecation('/api/me/paper', (_req, res) => {
    const paper = getPaper();
    if (!paper) return res.status(503).json({ ok: false, reason: 'paper_not_initialized' });
    res.json({ ok: true, positions: paper.positions() });
  }));

  app.get('/api/paper/trades', withDeprecation('/api/me/paper', (req, res) => {
    const paper = getPaper();
    if (!paper) return res.status(503).json({ ok: false, reason: 'paper_not_initialized' });
    const lim = parseInt(req.query.limit || '50', 10) || 50;
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

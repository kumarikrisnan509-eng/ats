// admin-misc.js -- T-388 (architecture audit #1, server.js god-object split #5).
//
// Three small operator-only admin singletons that don't naturally cluster with
// any other route group:
//   - POST /api/admin/market/refresh-holidays  (force-refresh MarketMeta)
//   - POST /api/admin/cron-reauth/run          (manual trigger of Tier 80 cron)
//   - GET  /api/admin/observability            (latency + recent errors)
//
// Public API
// ==========
//   const { mountAdminMiscRoutes } = require('./routes/admin-misc');
//   mountAdminMiscRoutes(app, { getMarketMeta, getCronReauth, getObs });
//
// All deps are getters because the underlying singletons are lazily set inside
// server.js's async init() and (in the cron case) re-initialised on certain
// admin actions. Passing closures avoids stale snapshots.

'use strict';

function mountAdminMiscRoutes(app, deps) {
  const { getMarketMeta, getCronReauth, getObs } = deps;
  if (typeof getMarketMeta  !== 'function') throw new Error('admin-misc: getMarketMeta getter required');
  if (typeof getCronReauth  !== 'function') throw new Error('admin-misc: getCronReauth getter required');
  if (typeof getObs         !== 'function') throw new Error('admin-misc: getObs getter required');

  // POST /api/admin/market/refresh-holidays
  // Force-refresh the MarketMeta holiday cache. Normally refreshed on a daily
  // schedule -- this route is for when the operator needs the new list NOW
  // (e.g. an unscheduled exchange holiday just got announced).
  app.post('/api/admin/market/refresh-holidays', async (req, res) => {
    if (!req.user || !req.user.is_admin) return res.status(403).json({ ok: false, reason: 'admin_only' });
    const mm = getMarketMeta();
    if (!mm) return res.status(503).json({ ok: false, reason: 'market_meta_unavailable' });
    const r = await mm.refreshFromBroker();
    res.json(r);
  });

  // POST /api/admin/cron-reauth/run
  // Tier 80: admin-only manual trigger for the daily Kite reauth cron. Useful
  // when the operator wants to test the path without waiting until 05:45 IST.
  app.post('/api/admin/cron-reauth/run', async (req, res) => {
    if (!req.user || !req.user.is_admin) return res.status(403).json({ ok: false, reason: 'admin_only' });
    const cron = getCronReauth();
    if (!cron) return res.status(503).json({ ok: false, reason: 'cron_unavailable' });
    const r = await cron.runNow();
    res.json(r);
  });

  // GET /api/admin/observability
  // Tier 70: latency snapshot + most-recent errors. Admin-only because it
  // exposes the (sometimes verbose) errors_log table that may contain SQL
  // fragments or other internal-state-y strings.
  app.get('/api/admin/observability', (req, res) => {
    const obs = getObs();
    if (!obs) return res.status(503).json({ ok: false, reason: 'observability_unavailable' });
    if (!req.user || !req.user.is_admin) return res.status(403).json({ ok: false, reason: 'admin_only' });
    res.json({
      ok: true,
      latency: obs.snapshot(),
      recentErrors: obs.recentErrors(50),
    });
  });
}

module.exports = { mountAdminMiscRoutes };

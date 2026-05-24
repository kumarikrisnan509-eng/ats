// autorun.js -- T-393 (architecture audit #1, server.js god-object split #10).
//
// Four routes for the strategy auto-runner subsystem (the cron-driven scan
// that consumes signals + risk gates and (when enabled + LIVE_TRADING)
// places paper orders).
//   - GET    /api/autorun       -- config + stats + recent history
//   - PUT    /api/autorun       -- replace config (enabled / strategy / qty / interval ...)
//   - POST   /api/autorun/run   -- manual evaluation trigger
//   - DELETE /api/autorun       -- clear config + stop the timer
//
// All operator-only in practice; gating is via existing global middleware
// (cookie auth must already be present for /api/* mutation endpoints in
// the production middleware chain).
//
// Public API
// ==========
//   const { mountAutorunRoutes } = require('./routes/autorun');
//   mountAutorunRoutes(app, { getAutorun });
//
// `getAutorun` is a getter because the `autorun` singleton is lazily
// initialised inside server.js's async init(). Closure avoids stale snapshot.

'use strict';

function mountAutorunRoutes(app, deps) {
  const { getAutorun } = deps;
  if (typeof getAutorun !== 'function') throw new Error('autorun: getAutorun getter required');

  app.get('/api/autorun', (_req, res) => {
    const autorun = getAutorun();
    if (!autorun) return res.status(503).json({ ok: false, reason: 'autorun_not_initialized' });
    res.json({ ok: true, config: autorun.config(), stats: autorun.stats(), history: autorun.history(25) });
  });

  app.put('/api/autorun', (req, res) => {
    const autorun = getAutorun();
    if (!autorun) return res.status(503).json({ ok: false, reason: 'autorun_not_initialized' });
    try {
      const cfg = autorun.setConfig(req.body || {});
      res.json({ ok: true, config: cfg, stats: autorun.stats() });
    } catch (e) { res.status(400).json({ ok: false, reason: e.message }); }
  });

  app.post('/api/autorun/run', async (_req, res) => {
    const autorun = getAutorun();
    if (!autorun) return res.status(503).json({ ok: false, reason: 'autorun_not_initialized' });
    try {
      const run = await autorun.runOnce({ source: 'manual' });
      res.json({ ok: true, run });
    } catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  });

  app.delete('/api/autorun', (_req, res) => {
    const autorun = getAutorun();
    if (!autorun) return res.status(503).json({ ok: false, reason: 'autorun_not_initialized' });
    autorun.clearConfig();
    res.json({ ok: true, stats: autorun.stats() });
  });
}

module.exports = { mountAutorunRoutes };

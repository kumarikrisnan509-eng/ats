// pnl.js -- T-401 (architecture audit #1, server.js god-object split #18).
//
// Three P&L attribution endpoints backed by the `pnl` singleton:
//   - GET  /api/pnl/daily?days=30   -- equity time series (default 30, max 730)
//   - GET  /api/pnl/by-strategy     -- aggregated closed-trade ledger
//   - POST /api/pnl/snapshot        -- manual snapshot trigger (ops endpoint)
//
// Public API
// ==========
//   const { mountPnlRoutes } = require('./routes/pnl');
//   mountPnlRoutes(app, { getPnl });

'use strict';

function mountPnlRoutes(app, deps) {
  const { getPnl } = deps;
  if (typeof getPnl !== 'function') throw new Error('pnl: getPnl getter required');

  app.get('/api/pnl/daily', (req, res) => {
    const pnl = getPnl();
    if (!pnl) return res.status(503).json({ ok: false, reason: 'pnl_not_initialized' });
    const days = Math.max(1, Math.min(730, parseInt(req.query.days || '30', 10) || 30));
    res.json({ ok: true, days, rows: pnl.history(days), stats: pnl.stats() });
  });

  app.get('/api/pnl/by-strategy', (_req, res) => {
    const pnl = getPnl();
    if (!pnl) return res.status(503).json({ ok: false, reason: 'pnl_not_initialized' });
    res.json({ ok: true, strategies: pnl.byStrategy() });
  });

  app.post('/api/pnl/snapshot', (_req, res) => {
    const pnl = getPnl();
    if (!pnl) return res.status(503).json({ ok: false, reason: 'pnl_not_initialized' });
    const row = pnl.snapshot();
    res.json({ ok: true, row });
  });
}

module.exports = { mountPnlRoutes };

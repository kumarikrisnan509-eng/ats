// me-pnl.js -- T-402 (architecture audit #1, server.js god-object split #22).
//
// Three user-scoped P&L aggregation endpoints (all auth-required):
//   - GET /api/me/pnl?n=30           -- daily P&L last N days for current user
//   - GET /api/me/pnl/monthly        -- per-month aggregation (paper_closed_trades)
//   - GET /api/me/sweep/monthly      -- per-month sweep ledger aggregation
//
// Public API
// ==========
//   const { mountMePnlRoutes } = require('./routes/me-pnl');
//   mountMePnlRoutes(app, { withAuth, getDb, getSweep });

'use strict';

function mountMePnlRoutes(app, deps) {
  const { withAuth, getDb, getSweep } = deps;
  if (typeof withAuth !== 'function') throw new Error('me-pnl: withAuth wrapper required');
  if (typeof getDb    !== 'function') throw new Error('me-pnl: getDb getter required');
  if (typeof getSweep !== 'function') throw new Error('me-pnl: getSweep getter required');

  // Daily P&L (last N days for current user)
  app.get('/api/me/pnl', withAuth((req, res) => {
    const db = getDb();
    const n = Math.min(365, Math.max(1, Number(req.query.n) || 30));
    res.json({ ok: true, rows: db.pnl.recent(req.user.id, n) });
  }));

  // T-156: per-month historical PnL aggregation.
  app.get('/api/me/pnl/monthly', withAuth((req, res) => {
    const db = getDb();
    if (!db || !db._conn) return res.status(503).json({ ok: false, reason: 'db_not_ready' });
    try {
      const { aggregateMonthly, summarize } = require('../pnl-monthly');

      const now = new Date();
      const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const m12Ago = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
      const defaultFrom = `${m12Ago.getUTCFullYear()}-${String(m12Ago.getUTCMonth() + 1).padStart(2, '0')}`;

      const fromMonth = /^\d{4}-\d{2}$/.test(req.query.from || '') ? req.query.from : defaultFrom;
      const toMonth   = /^\d{4}-\d{2}$/.test(req.query.to   || '') ? req.query.to   : thisMonth;

      const rows = db._conn.prepare(`
        SELECT pnl, exited_at, strategy_tag
        FROM paper_closed_trades
        WHERE user_id = ?
          AND substr(exited_at, 1, 7) >= ?
          AND substr(exited_at, 1, 7) <= ?
        ORDER BY exited_at ASC
      `).all(req.user.id, fromMonth, toMonth);

      const months = aggregateMonthly(rows);
      const summary = summarize(rows);
      res.json({
        ok: true,
        from: fromMonth,
        to: toMonth,
        summary,
        months,
      });
    } catch (e) {
      console.error('[/api/me/pnl/monthly] error:', e && e.message);
      res.status(500).json({ ok: false, reason: 'aggregation_failed', detail: String(e && e.message || e).slice(0, 200) });
    }
  }));

  // T-158: per-month sweep ledger aggregation.
  app.get('/api/me/sweep/monthly', withAuth((req, res) => {
    const sweep = getSweep();
    if (!sweep || typeof sweep.aggregateMonthly !== 'function') {
      return res.json({ ok: true, from: null, to: null, months: [], note: 'sweep_engine_not_initialised' });
    }
    try {
      const now = new Date();
      const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}`;
      const m12Ago = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 11, 1));
      const defaultFrom = `${m12Ago.getUTCFullYear()}-${String(m12Ago.getUTCMonth() + 1).padStart(2, '0')}`;
      const fromMonth = /^\d{4}-\d{2}$/.test(req.query.from || '') ? req.query.from : defaultFrom;
      const toMonth   = /^\d{4}-\d{2}$/.test(req.query.to   || '') ? req.query.to   : thisMonth;

      const months = sweep.aggregateMonthly({ fromMonth, toMonth });
      const current = months.find(m => m.month === thisMonth) || null;
      res.json({
        ok: true,
        from: fromMonth,
        to: toMonth,
        current_month: thisMonth,
        mtd: current ? current.total_inr : 0,
        mtd_count: current ? current.count : 0,
        mtd_by_target: current ? current.byTarget : {},
        months,
      });
    } catch (e) {
      console.error('[/api/me/sweep/monthly] error:', e && e.message);
      res.status(500).json({ ok: false, reason: 'aggregation_failed', detail: String(e && e.message || e).slice(0, 200) });
    }
  }));
}

module.exports = { mountMePnlRoutes };

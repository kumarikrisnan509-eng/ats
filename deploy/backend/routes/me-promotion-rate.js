// me-promotion-rate.js -- T-404 (architecture audit #1, server.js split #29).
// T-159: paper->live promotion-readiness rate. Feeds the Signals screen's
// "Paper->Live rate" tile.

'use strict';

function mountMePromotionRateRoutes(app, deps) {
  const { withAuth, getDb } = deps;
  if (typeof withAuth !== 'function') throw new Error('me-promotion-rate: withAuth required');
  if (typeof getDb    !== 'function') throw new Error('me-promotion-rate: getDb required');

  app.get('/api/me/signals/promotion-rate', withAuth((req, res) => {
    const db = getDb();
    if (!db || !db._conn) return res.status(503).json({ ok: false, reason: 'db_not_ready' });
    try {
      const { computePromotionRate } = require('../promotion-rate');
      const minTrades = Math.max(1, Math.min(100, parseInt(req.query.min_trades || '5', 10)));
      const days = Math.max(1, Math.min(365, parseInt(req.query.days || '30', 10)));

      const cutoff = new Date(Date.now() - days * 86400_000).toISOString();
      const rows = db._conn.prepare(`
        SELECT symbol, strategy_tag, pnl, exited_at
        FROM paper_closed_trades
        WHERE user_id = ?
          AND exited_at >= ?
      `).all(req.user.id, cutoff);

      const summary = computePromotionRate(rows, { minTrades });
      res.json({
        ok: true,
        window_days: days,
        min_trades: minTrades,
        ...summary,
      });
    } catch (e) {
      console.error('[/api/me/signals/promotion-rate] error:', e && e.message);
      res.status(500).json({ ok: false, reason: 'aggregation_failed', detail: String(e && e.message || e).slice(0, 200) });
    }
  }));
}

module.exports = { mountMePromotionRateRoutes };

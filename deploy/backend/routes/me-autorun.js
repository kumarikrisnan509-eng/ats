// me-autorun.js -- T-404 (architecture audit #1, server.js split #28).
// 3 per-user autorun config routes. Note: the GLOBAL /api/autorun lives in
// routes/autorun.js (extracted T-393); this module is the Tier-75 per-user
// equivalent backed by db.autorun.

'use strict';

function mountMeAutorunRoutes(app, deps) {
  const { withAuth, getDb } = deps;
  if (typeof withAuth !== 'function') throw new Error('me-autorun: withAuth required');
  if (typeof getDb    !== 'function') throw new Error('me-autorun: getDb required');

  app.get('/api/me/autorun', withAuth((req, res) => {
    const db = getDb();
    res.json({
      ok: true,
      config: db.autorun.get(req.user.id) || null,
      history: db.autorun.listHistory(req.user.id),
    });
  }));

  app.put('/api/me/autorun', withAuth((req, res) => {
    const db = getDb();
    const b = req.body || {};
    db.autorun.upsert({
      user_id: req.user.id,
      enabled: b.enabled ? 1 : 0,
      strategy: b.strategy || null,
      symbol: b.symbol || null,
      qty: Number(b.qty) || 1,
      interval: b.interval || 'day',
      interval_minutes: Number(b.intervalMinutes) || 60,
      candle_lookback_days: Number(b.candleLookbackDays) || 60,
    });
    res.json({ ok: true });
  }));

  app.delete('/api/me/autorun', withAuth((req, res) => {
    const db = getDb();
    db.autorun.delete(req.user.id);
    res.json({ ok: true });
  }));
}

module.exports = { mountMeAutorunRoutes };

// me-watchlist-alerts.js -- T-404 (architecture audit #1, server.js split #27).
// 6 per-user routes for watchlist + alerts (Tier 75 multi-tenant scope).

'use strict';

function mountMeWatchlistAlertsRoutes(app, deps) {
  const { withAuth, getDb, notifyWatchlistChange } = deps;
  if (typeof withAuth              !== 'function') throw new Error('me-watchlist-alerts: withAuth required');
  if (typeof getDb                 !== 'function') throw new Error('me-watchlist-alerts: getDb required');
  if (typeof notifyWatchlistChange !== 'function') throw new Error('me-watchlist-alerts: notifyWatchlistChange required');

  // ----- Watchlist -----
  app.get('/api/me/watchlist', withAuth((req, res) => {
    const db = getDb();
    res.json({ ok: true, items: db.watchlist.list(req.user.id) });
  }));
  app.post('/api/me/watchlist', withAuth((req, res) => {
    const db = getDb();
    const { symbol, exchange } = req.body || {};
    if (!symbol) return res.status(400).json({ ok: false, reason: 'symbol required' });
    const sym = String(symbol).toUpperCase();
    db.watchlist.add(req.user.id, sym, exchange || 'NSE');
    notifyWatchlistChange(req.user.id, 'add', sym);
    res.json({ ok: true });
  }));
  app.delete('/api/me/watchlist/:symbol', withAuth((req, res) => {
    const db = getDb();
    const sym = req.params.symbol.toUpperCase();
    db.watchlist.remove(req.user.id, sym);
    notifyWatchlistChange(req.user.id, 'remove', sym);
    res.json({ ok: true });
  }));

  // ----- Alerts -----
  app.get('/api/me/alerts', withAuth((req, res) => {
    const db = getDb();
    res.json({ ok: true, alerts: db.alerts.list(req.user.id) });
  }));
  app.post('/api/me/alerts', withAuth((req, res) => {
    const db = getDb();
    const { symbol, operator, triggerPrice, channel } = req.body || {};
    if (!symbol || !operator || triggerPrice == null) return res.status(400).json({ ok: false, reason: 'symbol/operator/triggerPrice required' });
    db.alerts.add(req.user.id, String(symbol).toUpperCase(), operator, Number(triggerPrice), channel);
    res.json({ ok: true });
  }));
  app.delete('/api/me/alerts/:id', withAuth((req, res) => {
    const db = getDb();
    db.alerts.remove(req.user.id, Number(req.params.id));
    res.json({ ok: true });
  }));
}

module.exports = { mountMeWatchlistAlertsRoutes };

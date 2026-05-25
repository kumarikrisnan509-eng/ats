// legacy-watchlist-alerts.js -- T-405 (architecture audit #1, server.js split #31).
//
// Pre-Tier 75 unscoped watchlist + alerts routes (9 total). All withDeprecation-
// wrapped so anon callers get 401 and every hit emits `legacy.route.hit` audit.
// New per-user equivalents live in routes/me-watchlist-alerts.js (T-404).
//
// Public API
// ==========
//   mountLegacyWatchlistAlertsRoutes(app, { getWatchlist, getAlerts, getBroker, withDeprecation });

'use strict';

function mountLegacyWatchlistAlertsRoutes(app, deps) {
  const { getWatchlist, getAlerts, getBroker, withDeprecation } = deps;
  if (typeof getWatchlist     !== 'function') throw new Error('legacy-watchlist-alerts: getWatchlist required');
  if (typeof getAlerts        !== 'function') throw new Error('legacy-watchlist-alerts: getAlerts required');
  if (typeof getBroker        !== 'function') throw new Error('legacy-watchlist-alerts: getBroker required');
  if (typeof withDeprecation  !== 'function') throw new Error('legacy-watchlist-alerts: withDeprecation required');

  // ----- Watchlist -----
  app.get('/api/watchlist', withDeprecation('/api/me/watchlist', (_req, res) => {
    const w = getWatchlist();
    if (!w) return res.status(503).json({ ok: false, reason: 'watchlist_not_initialized' });
    res.json({ ok: true, symbols: w.list() });
  }));

  app.put('/api/watchlist', withDeprecation('/api/me/watchlist', (req, res) => {
    const w = getWatchlist();
    if (!w) return res.status(503).json({ ok: false, reason: 'watchlist_not_initialized' });
    try {
      const symbols = w.set(req.body && req.body.symbols);
      const broker = getBroker();
      if (typeof broker.ensureSubscribed === 'function') {
        broker.ensureSubscribed(symbols).catch(e => console.warn('[legacy-watchlist] promise rejected:', e && e.message));
      }
      res.json({ ok: true, symbols });
    } catch (e) {
      res.status(400).json({ ok: false, reason: e.message });
    }
  }));

  app.post('/api/watchlist/add', withDeprecation('/api/me/watchlist', (req, res) => {
    const w = getWatchlist();
    if (!w) return res.status(503).json({ ok: false, reason: 'watchlist_not_initialized' });
    try {
      const sym = req.body && req.body.symbol;
      const out = w.add(sym);
      const broker = getBroker();
      if (out.added && typeof broker.ensureSubscribed === 'function') {
        broker.ensureSubscribed([sym]).catch(e => console.warn('[legacy-watchlist] promise rejected:', e && e.message));
      }
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(400).json({ ok: false, reason: e.message });
    }
  }));

  app.post('/api/watchlist/remove', withDeprecation('/api/me/watchlist', (req, res) => {
    const w = getWatchlist();
    if (!w) return res.status(503).json({ ok: false, reason: 'watchlist_not_initialized' });
    try {
      const out = w.remove(req.body && req.body.symbol);
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(400).json({ ok: false, reason: e.message });
    }
  }));

  // ----- Alerts -----
  app.get('/api/alerts', withDeprecation('/api/me/alerts', (_req, res) => {
    const a = getAlerts();
    if (!a) return res.status(503).json({ ok: false, reason: 'alerts_not_initialized' });
    res.json({ ok: true, alerts: a.list() });
  }));

  app.post('/api/alerts', withDeprecation('/api/me/alerts', (req, res) => {
    const a = getAlerts();
    if (!a) return res.status(503).json({ ok: false, reason: 'alerts_not_initialized' });
    try {
      const alert = a.add(req.body || {});
      res.status(201).json({ ok: true, alert });
    } catch (e) {
      res.status(400).json({ ok: false, reason: e.message });
    }
  }));

  app.delete('/api/alerts/:id', withDeprecation('/api/me/alerts', (req, res) => {
    const a = getAlerts();
    if (!a) return res.status(503).json({ ok: false, reason: 'alerts_not_initialized' });
    const ok = a.remove(req.params.id);
    res.status(ok ? 200 : 404).json({ ok });
  }));

  app.post('/api/alerts/:id/reset', withDeprecation('/api/me/alerts', (req, res) => {
    const a = getAlerts();
    if (!a) return res.status(503).json({ ok: false, reason: 'alerts_not_initialized' });
    const ok = a.reset(req.params.id);
    res.status(ok ? 200 : 404).json({ ok });
  }));

  app.get('/api/alerts/stats', withDeprecation('/api/me/alerts', (_req, res) => {
    const a = getAlerts();
    if (!a) return res.status(503).json({ ok: false, reason: 'alerts_not_initialized' });
    res.json({ ok: true, ...a.stats() });
  }));
}

module.exports = { mountLegacyWatchlistAlertsRoutes };

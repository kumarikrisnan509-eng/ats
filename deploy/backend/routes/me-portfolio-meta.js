// me-portfolio-meta.js -- T-403 (architecture audit #1, server.js split #23).
// 5 user-scoped regime + attribution + slippage routes.

'use strict';

function mountMePortfolioMetaRoutes(app, deps) {
  const { getRegimeDetector, getAttribution, getSlippageTracker } = deps;
  if (typeof getRegimeDetector  !== 'function') throw new Error('me-portfolio-meta: getRegimeDetector required');
  if (typeof getAttribution     !== 'function') throw new Error('me-portfolio-meta: getAttribution required');
  if (typeof getSlippageTracker !== 'function') throw new Error('me-portfolio-meta: getSlippageTracker required');

  // T-280
  app.get('/api/me/regime', async (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const rd = getRegimeDetector();
    if (!rd) return res.status(503).json({ ok: false, reason: 'regime_detector_not_initialized' });
    try { const r = await rd.cachedDetect(); res.json({ ok: true, regime: r }); }
    catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  });

  app.get('/api/me/regime/history', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const rd = getRegimeDetector();
    if (!rd) return res.status(503).json({ ok: false, reason: 'regime_detector_not_initialized' });
    const n = Math.max(1, Math.min(200, parseInt(req.query.n, 10) || 50));
    res.json({ ok: true, history: rd.history(n) });
  });

  // T-283
  app.get('/api/me/attribution', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const a = getAttribution();
    if (!a) return res.status(503).json({ ok: false, reason: 'attribution_not_initialized' });
    const n = Math.max(1, Math.min(365, parseInt(req.query.n, 10) || 30));
    res.json({ ok: true, recent: a.recent(n), stats: a.stats() });
  });

  app.post('/api/me/attribution/snapshot', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const a = getAttribution();
    if (!a) return res.status(503).json({ ok: false, reason: 'attribution_not_initialized' });
    try { res.json({ ok: true, row: a.snapshot() }); }
    catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  });

  // T-300
  app.get('/api/me/slippage', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const s = getSlippageTracker();
    if (!s) return res.status(503).json({ ok: false, reason: 'slippage_tracker_not_initialized' });
    try { res.json({ ok: true, slippage: s.compute() }); }
    catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  });
}

module.exports = { mountMePortfolioMetaRoutes };

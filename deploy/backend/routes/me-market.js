// me-market.js -- T-395 (architecture audit #1, server.js god-object split #12).
//
// Five user-scoped read-only market-data endpoints fronted by NSE-derived
// data feeds. All gate on req.user.id (auth required) but don't actually
// vary per user -- the data is global, the auth gate just keeps it
// off the public internet.
//
// Routes
// ======
//   GET /api/me/earnings/upcoming         -- next-N-days corporate-event calendar
//   GET /api/me/earnings/symbol/:sym      -- events for one ticker
//   GET /api/me/fiidii/today              -- FII/DII daily net activity snapshot
//   GET /api/me/bulk-deals/today          -- today's bulk + block deals
//   GET /api/me/bulk-deals/symbol/:sym    -- bulk + block deals for one ticker
//
// Public API
// ==========
//   const { mountMeMarketRoutes } = require('./routes/me-market');
//   mountMeMarketRoutes(app, { getEarningsCal, getFiidii, getBulkDeals });

'use strict';

function mountMeMarketRoutes(app, deps) {
  const { getEarningsCal, getFiidii, getBulkDeals } = deps;
  if (typeof getEarningsCal !== 'function') throw new Error('me-market: getEarningsCal required');
  if (typeof getFiidii      !== 'function') throw new Error('me-market: getFiidii required');
  if (typeof getBulkDeals   !== 'function') throw new Error('me-market: getBulkDeals required');

  // ============ E4: NSE earnings / corporate events ============
  app.get('/api/me/earnings/upcoming', async (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const cal = getEarningsCal();
    if (!cal) return res.status(503).json({ ok: false, reason: 'earnings_cal_not_ready' });
    try {
      const days = Math.max(1, Math.min(60, parseInt(req.query.days || '14', 10)));
      const category = req.query.category || null;
      const events = await cal.upcoming({ days, category });
      res.json({ ok: true, days, category: category || 'all', count: events.length, events });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'earnings_upcoming_failed', detail: e.message });
    }
  });

  app.get('/api/me/earnings/symbol/:sym', async (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const cal = getEarningsCal();
    if (!cal) return res.status(503).json({ ok: false, reason: 'earnings_cal_not_ready' });
    try {
      const days = Math.max(7, Math.min(180, parseInt(req.query.days || '60', 10)));
      const events = await cal.forSymbol(req.params.sym, { days });
      res.json({ ok: true, symbol: req.params.sym.toUpperCase(), days, count: events.length, events });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'earnings_symbol_failed', detail: e.message });
    }
  });

  // ============ E7: FII/DII daily activity ============
  app.get('/api/me/fiidii/today', async (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const fiidii = getFiidii();
    if (!fiidii) return res.status(503).json({ ok: false, reason: 'fiidii_not_ready' });
    try {
      const snap = await fiidii.snapshot();
      res.json({ ok: true, ...snap });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'fiidii_failed', detail: e.message });
    }
  });

  // ============ E8: bulk + block deals ============
  app.get('/api/me/bulk-deals/today', async (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const bd = getBulkDeals();
    if (!bd) return res.status(503).json({ ok: false, reason: 'bulk_deals_not_ready' });
    try {
      const limit = Math.max(5, Math.min(100, parseInt(req.query.limit || '30', 10)));
      const includeShort = req.query.short === '1';
      const out = await bd.today({ limit, includeShort });
      res.json({ ok: true, ...out });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'bulk_deals_failed', detail: e.message });
    }
  });

  app.get('/api/me/bulk-deals/symbol/:sym', async (req, res) => {
    if (!req.user || !req.user.id) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const bd = getBulkDeals();
    if (!bd) return res.status(503).json({ ok: false, reason: 'bulk_deals_not_ready' });
    try {
      const deals = await bd.forSymbol(req.params.sym);
      res.json({ ok: true, symbol: req.params.sym.toUpperCase(), count: deals.length, deals });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'bulk_deals_symbol_failed', detail: e.message });
    }
  });
}

module.exports = { mountMeMarketRoutes };

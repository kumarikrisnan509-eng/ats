// wealth.js -- T-401 (architecture audit #1, server.js god-object split #19).
//
// Wealth + long-term investing + portfolio-construction endpoints.
// Eleven routes batched together because they share the operator-only
// posture and the small "thin wrapper around X.method()" shape.
//
// Tier 18 -- long-term wealth (5 routes, backed by `longterm` singleton):
//   - GET  /api/sip
//   - PUT  /api/sip
//   - GET  /api/buckets
//   - PUT  /api/buckets
//   - POST /api/swp/simulate
//   - POST /api/goals/inflate
//
// Tier 21 -- reference catalogs (4 routes, backed by `wealth` singleton):
//   - GET  /api/bonds
//   - GET  /api/reits
//   - GET  /api/smallcase/baskets
//   - GET  /api/copy/traders
//
// Tier 22 -- MPT portfolio optimiser (1 route, backed by `mpt` singleton):
//   - POST /api/portfolio/optimize
//
// Tier 31 -- factor-tilt portfolio construction (1 route, backed by `factorTilt`):
//   - POST /api/portfolio/factor-tilt
//
// Public API
// ==========
//   const { mountWealthRoutes } = require('./routes/wealth');
//   mountWealthRoutes(app, { getLongterm, getWealth, getMpt, getFactorTilt });

'use strict';

function mountWealthRoutes(app, deps) {
  const { getLongterm, getWealth, getMpt, getFactorTilt } = deps;
  if (typeof getLongterm   !== 'function') throw new Error('wealth: getLongterm getter required');
  if (typeof getWealth     !== 'function') throw new Error('wealth: getWealth getter required');
  if (typeof getMpt        !== 'function') throw new Error('wealth: getMpt getter required');
  if (typeof getFactorTilt !== 'function') throw new Error('wealth: getFactorTilt getter required');

  // ----- Long-term (SIP / buckets / SWP / goal inflation) -----
  app.get('/api/sip', (_req, res) => {
    const longterm = getLongterm();
    if (!longterm) return res.status(503).json({ ok: false, reason: 'longterm_not_initialized' });
    res.json({ ok: true, sips: longterm.getSips(), stats: longterm.stats() });
  });
  app.put('/api/sip', (req, res) => {
    const longterm = getLongterm();
    if (!longterm) return res.status(503).json({ ok: false, reason: 'longterm_not_initialized' });
    try {
      const sips = longterm.setSips((req.body && req.body.sips) || []);
      res.json({ ok: true, sips });
    } catch (e) { res.status(400).json({ ok: false, reason: e.message }); }
  });
  app.get('/api/buckets', (_req, res) => {
    const longterm = getLongterm();
    if (!longterm) return res.status(503).json({ ok: false, reason: 'longterm_not_initialized' });
    res.json({ ok: true, buckets: longterm.getBuckets() });
  });
  app.put('/api/buckets', (req, res) => {
    const longterm = getLongterm();
    if (!longterm) return res.status(503).json({ ok: false, reason: 'longterm_not_initialized' });
    try {
      const b = longterm.setBuckets((req.body && req.body.buckets) || {});
      res.json({ ok: true, buckets: b });
    } catch (e) { res.status(400).json({ ok: false, reason: e.message }); }
  });
  app.post('/api/swp/simulate', (req, res) => {
    const longterm = getLongterm();
    if (!longterm) return res.status(503).json({ ok: false, reason: 'longterm_not_initialized' });
    try {
      const r = longterm.simulateSwp(req.body || {});
      res.json({ ok: true, ...r });
    } catch (e) { res.status(400).json({ ok: false, reason: e.message }); }
  });
  app.post('/api/goals/inflate', (req, res) => {
    const longterm = getLongterm();
    if (!longterm) return res.status(503).json({ ok: false, reason: 'longterm_not_initialized' });
    try {
      const r = longterm.inflateGoal(req.body || {});
      res.json({ ok: true, ...r });
    } catch (e) { res.status(400).json({ ok: false, reason: e.message }); }
  });

  // ----- Catalogs (bonds / REITs / smallcases / copy-traders) -----
  app.get('/api/bonds', (_req, res) => {
    const wealth = getWealth();
    if (!wealth) return res.status(503).json({ ok: false, reason: 'wealth_not_initialized' });
    res.json(wealth.getBonds());
  });
  app.get('/api/reits', (_req, res) => {
    const wealth = getWealth();
    if (!wealth) return res.status(503).json({ ok: false, reason: 'wealth_not_initialized' });
    res.json(wealth.getReits());
  });
  app.get('/api/smallcase/baskets', (_req, res) => {
    const wealth = getWealth();
    if (!wealth) return res.status(503).json({ ok: false, reason: 'wealth_not_initialized' });
    res.json(wealth.getSmallcases());
  });
  app.get('/api/copy/traders', (_req, res) => {
    const wealth = getWealth();
    if (!wealth) return res.status(503).json({ ok: false, reason: 'wealth_not_initialized' });
    res.json(wealth.getTraders());
  });

  // ----- MPT portfolio optimiser -----
  app.post('/api/portfolio/optimize', (req, res) => {
    const mpt = getMpt();
    if (!mpt) return res.status(503).json({ ok: false, reason: 'mpt_not_initialized' });
    try {
      const out = mpt.optimize(req.body || {});
      res.json(out);
    } catch (e) {
      res.status(400).json({ ok: false, reason: e.message });
    }
  });

  // ----- Factor-tilt portfolio construction -----
  app.post('/api/portfolio/factor-tilt', (req, res) => {
    const factorTilt = getFactorTilt();
    if (!factorTilt) return res.status(503).json({ ok: false, reason: 'factor_tilt_not_initialized' });
    try {
      const out = factorTilt.build(req.body || {});
      res.json(out);
    } catch (e) {
      res.status(400).json({ ok: false, reason: e.message });
    }
  });
}

module.exports = { mountWealthRoutes };

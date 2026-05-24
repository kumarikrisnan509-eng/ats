// tax-sweep.js -- T-394 (architecture audit #1, server.js god-object split #11).
//
// Two closely-related wealth-management subsystems batched as one module
// because both are tiny and both follow the same get/put/action pattern.
//
// Tax-planning routes (5):
//   - GET  /api/tax/goals     -- current tax-saving goal targets
//   - PUT  /api/tax/goals     -- replace goals list
//   - GET  /api/tax/harvest   -- harvest rules + opportunities found right now
//   - PUT  /api/tax/harvest   -- replace harvest rule set
//   - POST /api/tax/realize   -- mark trades as harvested (writes ledger entry)
//
// Sweep routes (4) -- profit-to-long-term automation:
//   - GET  /api/sweep            -- rules + history + stats
//   - PUT  /api/sweep            -- replace rule set
//   - GET  /api/sweep/evaluate   -- dry-run preview without executing
//   - POST /api/sweep/execute    -- run the sweep, writes ledger
//
// Public API
// ==========
//   const { mountTaxSweepRoutes } = require('./routes/tax-sweep');
//   mountTaxSweepRoutes(app, { getTax, getSweep });
//
// Both deps as getters because tax/sweep singletons are lazy-init in
// server.js async init().

'use strict';

function mountTaxSweepRoutes(app, deps) {
  const { getTax, getSweep } = deps;
  if (typeof getTax   !== 'function') throw new Error('tax-sweep: getTax getter required');
  if (typeof getSweep !== 'function') throw new Error('tax-sweep: getSweep getter required');

  // ----- Tax -----
  app.get('/api/tax/goals', (_req, res) => {
    const tax = getTax();
    if (!tax) return res.status(503).json({ ok: false, reason: 'tax_not_initialized' });
    res.json({ ok: true, goals: tax.getGoals() });
  });
  app.put('/api/tax/goals', (req, res) => {
    const tax = getTax();
    if (!tax) return res.status(503).json({ ok: false, reason: 'tax_not_initialized' });
    try {
      const goals = tax.setGoals((req.body && req.body.goals) || []);
      res.json({ ok: true, goals });
    } catch (e) { res.status(400).json({ ok: false, reason: e.message }); }
  });
  app.get('/api/tax/harvest', (_req, res) => {
    const tax = getTax();
    if (!tax) return res.status(503).json({ ok: false, reason: 'tax_not_initialized' });
    res.json({ ok: true, rules: tax.getHarvestRules(), opportunities: tax.findHarvestOpportunities() });
  });
  app.put('/api/tax/harvest', (req, res) => {
    const tax = getTax();
    if (!tax) return res.status(503).json({ ok: false, reason: 'tax_not_initialized' });
    try {
      const rules = tax.setHarvestRules((req.body && req.body.rules) || {});
      res.json({ ok: true, rules });
    } catch (e) { res.status(400).json({ ok: false, reason: e.message }); }
  });
  app.post('/api/tax/realize', (req, res) => {
    const tax = getTax();
    if (!tax) return res.status(503).json({ ok: false, reason: 'tax_not_initialized' });
    try {
      const entry = tax.realizeHarvest((req.body && req.body.tradeIds) || [], req.body && req.body.note);
      res.json({ ok: true, entry });
    } catch (e) { res.status(400).json({ ok: false, reason: e.message }); }
  });

  // ----- Sweep -----
  app.get('/api/sweep', (_req, res) => {
    const sweep = getSweep();
    if (!sweep) return res.status(503).json({ ok: false, reason: 'sweep_not_initialized' });
    res.json({ ok: true, rules: sweep.getRules(), history: sweep.history(50), stats: sweep.stats() });
  });
  app.put('/api/sweep', (req, res) => {
    const sweep = getSweep();
    if (!sweep) return res.status(503).json({ ok: false, reason: 'sweep_not_initialized' });
    try {
      const rules = sweep.setRules((req.body && req.body.rules) || []);
      res.json({ ok: true, rules });
    } catch (e) { res.status(400).json({ ok: false, reason: e.message }); }
  });
  app.get('/api/sweep/evaluate', (_req, res) => {
    const sweep = getSweep();
    if (!sweep) return res.status(503).json({ ok: false, reason: 'sweep_not_initialized' });
    res.json({ ok: true, ...sweep.evaluate() });
  });
  app.post('/api/sweep/execute', (_req, res) => {
    const sweep = getSweep();
    if (!sweep) return res.status(503).json({ ok: false, reason: 'sweep_not_initialized' });
    const r = sweep.execute();
    res.json({ ok: true, ...r });
  });
}

module.exports = { mountTaxSweepRoutes };

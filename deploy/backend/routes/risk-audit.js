// risk-audit.js -- T-399 (architecture audit #1, server.js god-object split #16).
//
// Compliance-adjacent endpoints for risk estimation and audit-log integrity:
//
//   POST /api/risk/span         -- SPAN-style margin estimator (~10-15% of real
//                                  broker margin; uses public NSE formulas, real
//                                  SPAN files are exchange-distributed proprietary).
//   GET  /api/audit/root        -- WORM chain head: head hash, head seq, Merkle root,
//                                  entry count. Fast O(file-size); cache-friendly.
//   GET  /api/audit/verify      -- walks the entire chain, recomputes every hash.
//                                  Slow; for periodic integrity audits.
//   GET  /api/audit/tail?n      -- last N entries from the WORM log (default 100).
//
// Public API
// ==========
//   const { mountRiskAuditRoutes } = require('./routes/risk-audit');
//   mountRiskAuditRoutes(app, { getSpanSim, getWormAudit, audit });

'use strict';

function mountRiskAuditRoutes(app, deps) {
  const { getSpanSim, getWormAudit, audit } = deps;
  if (typeof getSpanSim    !== 'function') throw new Error('risk-audit: getSpanSim getter required');
  if (typeof getWormAudit  !== 'function') throw new Error('risk-audit: getWormAudit getter required');
  if (typeof audit         !== 'function') throw new Error('risk-audit: audit required');

  // POST /api/risk/span
  // Returns total/SPAN/exposure margin, per-leg breakdown, detected spread structures.
  app.post('/api/risk/span', (req, res) => {
    const spanSim = getSpanSim();
    if (!spanSim) return res.status(503).json({ ok: false, reason: 'span_sim_not_initialized' });
    try {
      const out = spanSim.estimate(req.body || {});
      audit('risk.span.estimate', { legs: (req.body && req.body.legs && req.body.legs.length) || 0, total: out.totalMargin });
      res.json(out);
    } catch (e) {
      res.status(400).json({ ok: false, reason: e.message });
    }
  });

  // GET /api/audit/root
  app.get('/api/audit/root', (_req, res) => {
    const w = getWormAudit();
    if (!w) return res.status(503).json({ ok: false, reason: 'worm_not_initialized' });
    try { res.json({ ok: true, ...w.root() }); }
    catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  });

  // GET /api/audit/verify
  app.get('/api/audit/verify', (_req, res) => {
    const w = getWormAudit();
    if (!w) return res.status(503).json({ ok: false, reason: 'worm_not_initialized' });
    try { res.json(w.verify()); }
    catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  });

  // GET /api/audit/tail?n=100
  app.get('/api/audit/tail', (req, res) => {
    const w = getWormAudit();
    if (!w) return res.status(503).json({ ok: false, reason: 'worm_not_initialized' });
    try { res.json({ ok: true, entries: w.tail(Number(req.query.n) || 100) }); }
    catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  });
}

module.exports = { mountRiskAuditRoutes };

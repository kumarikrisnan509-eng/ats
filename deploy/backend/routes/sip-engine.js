// sip-engine.js -- T-403 (architecture audit #1, server.js split #25).
// T-276: SIP runner endpoints. Auth-gated; user_id pinned to 1 (operator) for now.

'use strict';

function mountSipEngineRoutes(app, deps) {
  const { getSipRunner } = deps;
  if (typeof getSipRunner !== 'function') throw new Error('sip-engine: getSipRunner required');

  app.get('/api/sip/plan', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const r = getSipRunner();
    if (!r) return res.status(503).json({ ok: false, reason: 'sip_runner_not_initialized' });
    res.json({ ok: true, plan: r.plan(1), stats: r.stats() });
  });

  app.post('/api/sip/fire', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const r = getSipRunner();
    if (!r) return res.status(503).json({ ok: false, reason: 'sip_runner_not_initialized' });
    const dryRun = req.body && req.body.dryRun !== false; // default dry-run for safety
    const result = r.runOnce(1, { dryRun });
    res.json({ ok: true, dryRun, result });
  });

  app.get('/api/sip/history', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const r = getSipRunner();
    if (!r) return res.status(503).json({ ok: false, reason: 'sip_runner_not_initialized' });
    const days = Math.max(1, Math.min(365, parseInt(req.query.days, 10) || 30));
    res.json({ ok: true, history: r.history(1, days) });
  });
}

module.exports = { mountSipEngineRoutes };

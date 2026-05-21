// T-262: /api/me/risk-config GET/PUT.
//
// Per-user risk-management config. Replaces scripts/SETUP-TRADING.cmd: the
// operator (and eventually any user) configures trading capital, risk caps,
// DCA mix, strategy voting, and trading mode from the live website instead
// of running a CLI.
//
// Auth: every handler requires req.user (set by the cookie-session middleware
// in server.js). Returns 503 if the service isn't initialised yet -- mirrors
// the getter pattern used by mountAuthRoutes (T-216/T-228) so the route is
// safe to wire at top-level before init() runs.
//
// CSRF: enforced globally by the middleware in server.js, no per-route work.
//
// External deps (passed via mount function options):
//   getRiskConfig - () => riskConfigService instance from services/risk-config.js
//   getAuth       - () => auth (only used for the 503 guard, mirroring auth.js)

'use strict';

function mountRiskConfigRoutes(app, deps) {
  const { getRiskConfig, getAuth } = deps;

  app.get('/api/me/risk-config', (req, res) => {
    const auth = getAuth();
    if (!auth) return res.status(503).json({ ok: false, reason: 'auth_not_initialized' });
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const svc = getRiskConfig();
    if (!svc) return res.status(503).json({ ok: false, reason: 'risk_config_not_initialized' });
    try {
      const config = svc.get(req.user.id);
      res.json({ ok: true, config });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  app.put('/api/me/risk-config', (req, res) => {
    const auth = getAuth();
    if (!auth) return res.status(503).json({ ok: false, reason: 'auth_not_initialized' });
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    const svc = getRiskConfig();
    if (!svc) return res.status(503).json({ ok: false, reason: 'risk_config_not_initialized' });
    try {
      const partial = req.body || {};
      const config = svc.upsert(req.user.id, partial);
      res.json({ ok: true, config });
    } catch (e) {
      // Validation errors throw with the offending field in the message --
      // surface as 400 so the UI can render inline.
      res.status(400).json({ ok: false, reason: e.message });
    }
  });
}

module.exports = { mountRiskConfigRoutes };

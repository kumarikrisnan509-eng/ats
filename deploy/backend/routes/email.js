// email.js -- T-401 (architecture audit #1, server.js god-object split #20).
//
// Tier 27 -- public email-alert endpoints (status + send). The
// admin-internal-gated mirror (/api/admin/email-*) lives in
// routes/email-admin.js (extracted earlier in T-386).
//
//   - GET  /api/email/status
//   - POST /api/email/send       body: { to, subject, text }
//
// Public API
// ==========
//   const { mountEmailRoutes } = require('./routes/email');
//   mountEmailRoutes(app, { getEmailAlerts });

'use strict';

function mountEmailRoutes(app, deps) {
  // T-428 (audit-2026-05-26 backend H1): added withAuth dep.
  const { getEmailAlerts, withAuth } = deps;
  if (typeof getEmailAlerts !== 'function') throw new Error('email: getEmailAlerts getter required');
  if (typeof withAuth !== 'function') throw new Error('email: withAuth required');

  app.get('/api/email/status', (_req, res) => {
    const emailAlerts = getEmailAlerts();
    if (!emailAlerts) return res.status(503).json({ ok: false, reason: 'email_not_initialized' });
    res.json({ ok: true, ...emailAlerts.status() });
  });

  // T-428 (audit-2026-05-26 backend H1): wrapped with withAuth. Was unauth --
  // any cookie-auth user could blast email from platform SMTP creds; reputation
  // damage + phishing-as-a-service. Now requires session.
  app.post('/api/email/send', withAuth(async (req, res) => {
    const emailAlerts = getEmailAlerts();
    if (!emailAlerts) return res.status(503).json({ ok: false, reason: 'email_not_initialized' });
    const { to, subject, text } = req.body || {};
    const r = await emailAlerts.send({ to, subject, text });
    res.json(r);
  }));
}

module.exports = { mountEmailRoutes };

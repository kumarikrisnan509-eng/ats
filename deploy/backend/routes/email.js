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
  const { getEmailAlerts } = deps;
  if (typeof getEmailAlerts !== 'function') throw new Error('email: getEmailAlerts getter required');

  app.get('/api/email/status', (_req, res) => {
    const emailAlerts = getEmailAlerts();
    if (!emailAlerts) return res.status(503).json({ ok: false, reason: 'email_not_initialized' });
    res.json({ ok: true, ...emailAlerts.status() });
  });

  app.post('/api/email/send', async (req, res) => {
    const emailAlerts = getEmailAlerts();
    if (!emailAlerts) return res.status(503).json({ ok: false, reason: 'email_not_initialized' });
    const { to, subject, text } = req.body || {};
    const r = await emailAlerts.send({ to, subject, text });
    res.json(r);
  });
}

module.exports = { mountEmailRoutes };

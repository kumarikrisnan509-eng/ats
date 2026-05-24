// email-admin.js -- T-386 (architecture audit #1, server.js god-object split).
//
// Two admin endpoints for the operator's outbound email transport (SMTP /
// SendGrid / whatever EmailAlerts.send() is wired to). Both are internal-only
// (loopback + private docker network + X-ATS-Internal:1 header) -- they
// never appear on the public internet because nginx strips the header.
//
// History
// =======
//   T-27   introduced EmailAlerts as the outbound transport singleton
//   T-?    added the GET status + POST test admin endpoints for first-time
//          configuration smoke-testing
//   T-386  extracted from server.js. Same `requireInternal` gate as before
//          (passed in as a dep so we don't have to duplicate the IP/header
//          check logic).
//
// Public API
// ==========
//   const { mountEmailAdminRoutes } = require('./routes/email-admin');
//   mountEmailAdminRoutes(app, { getEmailAlerts, audit, requireInternal, express });
//
// `getEmailAlerts` is a getter because emailAlerts is lazily initialised inside
// server.js's async init(); passing it as a closure ensures we always see the
// latest value.

'use strict';

function mountEmailAdminRoutes(app, deps) {
  const { getEmailAlerts, audit, requireInternal, express } = deps;
  if (typeof getEmailAlerts !== 'function') throw new Error('email-admin: getEmailAlerts getter required');
  if (typeof audit !== 'function')          throw new Error('email-admin: audit required');
  if (typeof requireInternal !== 'function') throw new Error('email-admin: requireInternal required');
  if (!express) throw new Error('email-admin: express required');

  // GET /api/admin/email-status -- returns the EmailAlerts.status() shape.
  // For SMTP provider this includes { host, port, user, passConfigured:bool }
  // -- the password value is NEVER returned.
  app.get('/api/admin/email-status', (req, res) => {
    if (!requireInternal(req, res)) return;
    const emailAlerts = getEmailAlerts();
    if (!emailAlerts) return res.status(503).json({ ok: false, reason: 'email_not_initialized' });
    res.json({ ok: true, ...emailAlerts.status() });
  });

  // POST /api/admin/email-test  body: { to, subject, text }
  // Sends one email through the configured transport. Useful first
  // smoke-test after env update.
  app.post('/api/admin/email-test', express.json({ limit: '32kb' }), async (req, res) => {
    if (!requireInternal(req, res)) return;
    const emailAlerts = getEmailAlerts();
    if (!emailAlerts) return res.status(503).json({ ok: false, reason: 'email_not_initialized' });
    const { to, subject, text } = req.body || {};
    if (!to || !subject || !text) {
      return res.status(400).json({ ok: false, reason: 'to_subject_text_required' });
    }
    try {
      const r = await emailAlerts.send({ to, subject, text });
      audit('email.admin_test', { to, subject, ok: r.ok, provider: r.provider, id: r.id });
      res.json(r);
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'send_failed', detail: String(e && e.message).slice(0, 300) });
    }
  });
}

module.exports = { mountEmailAdminRoutes };

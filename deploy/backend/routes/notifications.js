// notifications.js -- T-397 (architecture audit #1, server.js god-object split #14).
//
// Outbound notification channels -- WhatsApp (Twilio HTTP) + email digest.
// Both are operator-only in production via the existing global middleware
// chain; per-route auth gating is not added here because none was present
// in the original inline implementations.
//
// Routes
// ======
//   GET  /api/whatsapp/status   -- transport config + last-send result
//   POST /api/whatsapp/send     -- send one message (body: { to, body })
//   GET  /api/digest/preview    -- render the daily/weekly digest HTML
//                                  (no send; for eyeballing the template)
//   POST /api/digest/send       -- send the digest via Tier 27 EmailAlerts
//
// /api/cas/parse stays in server.js -- it's a CAS-PDF parser endpoint, not
// a notification channel, despite sitting near these routes.
//
// Public API
// ==========
//   const { mountNotificationRoutes } = require('./routes/notifications');
//   mountNotificationRoutes(app, { getWhatsApp, getDigest });

'use strict';

function mountNotificationRoutes(app, deps) {
  const { getWhatsApp, getDigest } = deps;
  if (typeof getWhatsApp !== 'function') throw new Error('notifications: getWhatsApp getter required');
  if (typeof getDigest   !== 'function') throw new Error('notifications: getDigest getter required');

  // ----- WhatsApp -----
  app.get('/api/whatsapp/status', (_req, res) => {
    const w = getWhatsApp();
    if (!w) return res.status(503).json({ ok: false, reason: 'whatsapp_not_initialized' });
    res.json({ ok: true, ...w.status() });
  });

  app.post('/api/whatsapp/send', async (req, res) => {
    const w = getWhatsApp();
    if (!w) return res.status(503).json({ ok: false, reason: 'whatsapp_not_initialized' });
    const { to, body } = req.body || {};
    const r = await w.send({ to, body });
    res.json(r);
  });

  // ----- Digest -----
  app.post('/api/digest/send', async (req, res) => {
    const digest = getDigest();
    if (!digest) return res.status(503).json({ ok: false, reason: 'digest_not_initialized' });
    const { kind, to } = req.body || {};
    const r = await digest.send({ kind: kind || 'daily', to });
    res.json(r);
  });

  app.get('/api/digest/preview', (req, res) => {
    const digest = getDigest();
    if (!digest) return res.status(503).json({ ok: false, reason: 'digest_not_initialized' });
    try {
      const { html } = digest.build({ kind: req.query.kind || 'daily' });
      res.set('Content-Type', 'text/html; charset=utf-8');
      res.send(html);
    } catch (e) { res.status(500).json({ ok: false, reason: e.message }); }
  });
}

module.exports = { mountNotificationRoutes };

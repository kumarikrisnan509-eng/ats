// me-identity.js -- T-406 (architecture audit #1, server.js split #33).
// 2 per-user identity/prefs routes (T99-T67 / T99-T70).

'use strict';

function mountMeIdentityRoutes(app, deps) {
  const { getDb } = deps;
  if (typeof getDb !== 'function') throw new Error('me-identity: getDb required');

  // T99-T70: per-user preferences
  app.get('/api/me/prefs', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    try {
      const db = getDb();
      const row = db && db.prefs && typeof db.prefs.get === 'function'
        ? db.prefs.get(req.user.id) : null;
      res.json({
        ok: true,
        prefs: row || {
          theme: 'auto', density: 'comfortable', currency_format: 'abbrev',
          round_rupees: 0, show_pnl_in_header: 1, daily_ai_cap_inr: 50,
          ai_mode: 'balanced', redact_pii: 1,
        },
      });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });

  // T99-T67: per-user identity (excludes password_hash / tokens / locked_until)
  app.get('/api/me/identity', (req, res) => {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    res.json({
      ok: true,
      user: {
        id:            req.user.id,
        email:         req.user.email,
        name:          req.user.name || null,
        is_verified:   !!req.user.is_verified,
        is_admin:      !!req.user.is_admin,
        created_at:    req.user.created_at,
        last_login_at: req.user.last_login_at || null,
      },
    });
  });
}

module.exports = { mountMeIdentityRoutes };

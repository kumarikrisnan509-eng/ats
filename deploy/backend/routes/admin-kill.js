// T-484: /api/admin/soft-kill endpoints.
//
// Backs the UI top-right Kill button (src/shell.jsx). Before T-484 the UI
// fired a frontend-only event with no backend effect -- operators got
// false confidence. Now the button POSTs here, which sets the in-memory
// soft-kill flag that pre-trade.js GATE 0 enforces.
//
// Endpoints:
//   GET  /api/admin/soft-kill          -- read state (also exposes env KILL_SWITCH for context)
//   POST /api/admin/soft-kill          -- fire (auth-gated, audit-logged, Telegram-notified)
//   POST /api/admin/soft-kill-reset    -- clear (auth-gated, audit-logged, Telegram-notified)
//
// Auth: req.user required for both POSTs (cookie-session middleware).
// CSRF: enforced globally; no per-route work needed.
// Audit: emits 'admin.softKill.fired' / 'admin.softKill.reset' WORM entries.
// Telegram: best-effort alerts -- failures don't block the state change.

'use strict';

const softKill = require('../services/soft-kill');

function mountAdminKillRoutes(app, deps) {
  const { getAuth, getAudit, getNotify } = deps;

  function _audit(event, data) {
    try {
      const a = (typeof getAudit === 'function') ? getAudit() : null;
      if (typeof a === 'function') a(event, data);
    } catch (_) { /* never let audit kill the route */ }
  }

  async function _alert(text) {
    try {
      const notify = (typeof getNotify === 'function') ? getNotify() : null;
      if (notify && typeof notify.postTelegram === 'function') {
        await notify.postTelegram(text);
      }
    } catch (_) { /* Telegram failures must not block the kill flow */ }
  }

  app.get('/api/admin/soft-kill', (_req, res) => {
    res.json({
      ok: true,
      ...softKill.state(),
      persistentKillSwitch: process.env.KILL_SWITCH === 'true',
    });
  });

  app.post('/api/admin/soft-kill', async (req, res) => {
    const auth = getAuth();
    if (!auth) return res.status(503).json({ ok: false, reason: 'auth_not_initialized' });
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });

    const body = req.body || {};
    const reason = body.reason ? String(body.reason).slice(0, 200) : 'ui-kill-button';

    const wasActive = softKill.get();
    softKill.set({ userId: req.user.id, reason });

    _audit('admin.softKill.fired', {
      userId: req.user.id,
      email: req.user.email || null,
      reason,
      wasAlreadyActive: wasActive,
      ip: req.ip || (req.headers && req.headers['x-forwarded-for']) || null,
      ua: (req.headers && req.headers['user-agent']) || null,
    });

    // Best-effort Telegram alert
    const text = [
      '🛑 *ATS SOFT-KILL FIRED*',
      '',
      'Automated live order placement is now BLOCKED by the in-memory',
      'soft-kill flag. The env KILL_SWITCH var is unchanged.',
      '',
      'Fired by   : ' + (req.user.email || req.user.id),
      'Reason     : ' + reason,
      'Time       : ' + new Date().toISOString(),
      '',
      'To re-enable: POST /api/admin/soft-kill-reset (or click Reset in UI).',
    ].join('\n');
    _alert(text); // fire-and-forget

    res.json({ ok: true, ...softKill.state() });
  });

  app.post('/api/admin/soft-kill-reset', async (req, res) => {
    const auth = getAuth();
    if (!auth) return res.status(503).json({ ok: false, reason: 'auth_not_initialized' });
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });

    if (!softKill.get()) {
      return res.json({ ok: true, alreadyClear: true, ...softKill.state() });
    }

    const prev = softKill.state();
    softKill.reset();

    _audit('admin.softKill.reset', {
      userId: req.user.id,
      email: req.user.email || null,
      prev,
      ip: req.ip || (req.headers && req.headers['x-forwarded-for']) || null,
    });

    const text = [
      '✅ *ATS soft-kill RESET*',
      '',
      'Reset by   : ' + (req.user.email || req.user.id),
      'Was fired  : ' + (prev.firedAt ? new Date(prev.firedAt).toISOString() : '?'),
      'Reason was : ' + (prev.reason || '?'),
      '',
      'Automated live order placement is re-enabled subject to other gates',
      '(env KILL_SWITCH, LIVE_TRADING, tradingMode, daily-loss, etc.).',
    ].join('\n');
    _alert(text);

    res.json({ ok: true, ...softKill.state() });
  });
}

module.exports = { mountAdminKillRoutes };

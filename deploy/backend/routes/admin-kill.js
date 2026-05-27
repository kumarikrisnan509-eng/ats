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
  // T-490: getRiskConfig is the NEW dep -- needed so the kill button can
  // also flip the user's activeModes to disabled (and restore on reset).
  const { getAuth, getAudit, getNotify, getRiskConfig } = deps;

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

    // T-490: snapshot the user's activeModes BEFORE flipping the kill flag.
    // Best-effort: if risk-config service isn't initialized or read fails, we
    // still fire the kill (the in-memory flag is the safety-critical part);
    // we just won't be able to pause/restore the per-mode toggles.
    let snapshotActiveModes = null;
    let modesPausedCount = 0;
    let modePauseError = null;
    try {
      const svc = (typeof getRiskConfig === 'function') ? getRiskConfig() : null;
      if (svc && typeof svc.get === 'function' && typeof svc.upsert === 'function') {
        const cfg = svc.get(req.user.id);
        if (cfg && cfg.activeModes && typeof cfg.activeModes === 'object') {
          // Deep-clone the snapshot before we mutate (safer than relying on
          // svc.get to return a fresh object).
          snapshotActiveModes = JSON.parse(JSON.stringify(cfg.activeModes));
          // Build the paused-modes object: every existing mode flipped to
          // enabled:false. We preserve all other per-mode fields (capitalPct,
          // mode-specific settings) so reset is a pure re-enable.
          const pausedModes = {};
          for (const [modeId, modeCfg] of Object.entries(snapshotActiveModes)) {
            if (modeCfg && typeof modeCfg === 'object') {
              pausedModes[modeId] = { ...modeCfg, enabled: false };
              if (modeCfg.enabled) modesPausedCount++;
            }
          }
          svc.upsert(req.user.id, { activeModes: pausedModes });
        }
      }
    } catch (e) {
      modePauseError = e && e.message ? e.message : String(e);
      _audit('admin.softKill.modePauseFailed', { userId: req.user.id, msg: modePauseError });
      // Do NOT abort the kill. The in-memory flag is the primary safety gate.
    }

    const wasActive = softKill.get();
    softKill.set({ userId: req.user.id, reason, snapshotActiveModes });

    _audit('admin.softKill.fired', {
      userId: req.user.id,
      email: req.user.email || null,
      reason,
      wasAlreadyActive: wasActive,
      modesPausedCount,
      modePauseError,  // null on success
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

    res.json({ ok: true, modesPausedCount, ...softKill.state() });
  });

  app.post('/api/admin/soft-kill-reset', async (req, res) => {
    const auth = getAuth();
    if (!auth) return res.status(503).json({ ok: false, reason: 'auth_not_initialized' });
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });

    if (!softKill.get()) {
      return res.json({ ok: true, alreadyClear: true, ...softKill.state() });
    }

    const prev = softKill.state();

    // T-490: restore the activeModes snapshot that was captured at fire time.
    // Best-effort: if the snapshot is missing (e.g. backend restarted with
    // KILL_SWITCH=true while soft-kill was still active) we just clear the
    // flag and warn -- the operator can re-enable modes manually from UI.
    let modesRestoredCount = 0;
    let modeRestoreError = null;
    try {
      const snapshot = softKill.getSnapshotActiveModes();
      const svc = (typeof getRiskConfig === 'function') ? getRiskConfig() : null;
      if (snapshot && svc && typeof svc.upsert === 'function') {
        svc.upsert(req.user.id, { activeModes: snapshot });
        for (const m of Object.values(snapshot)) {
          if (m && m.enabled) modesRestoredCount++;
        }
      }
    } catch (e) {
      modeRestoreError = e && e.message ? e.message : String(e);
      _audit('admin.softKill.modeRestoreFailed', { userId: req.user.id, msg: modeRestoreError });
    }

    softKill.reset();

    _audit('admin.softKill.reset', {
      userId: req.user.id,
      email: req.user.email || null,
      prev,
      modesRestoredCount,
      modeRestoreError,  // null on success
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

    res.json({ ok: true, modesRestoredCount, ...softKill.state() });
  });
}

module.exports = { mountAdminKillRoutes };

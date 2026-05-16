// account-routes.js -- Tier 84: per-user account, preferences, notifications, export.
// Mounted under /api/v1/me/* by server.js.

'use strict';

function createAccountRouter({ db, vault, requireAuth, auth }) {
  const express = require('express');
  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));
  router.use(requireAuth);

  const seal = async (plain) => {
    if (plain == null || plain === '') return null;
    return vault.seal(String(plain));
  };

  // ---- ACCOUNT ----
  router.get('/account', (req, res) => {
    const u = db.users.byId(req.user.id);
    if (!u) return res.status(404).json({ ok: false, reason: 'not_found' });
    res.json({ ok: true, account: {
      id: u.id, name: u.name, email: u.email, is_verified: !!u.is_verified, is_admin: !!u.is_admin,
      created_at: u.created_at, last_login_at: u.last_login_at,
    }});
  });

  router.patch('/account', async (req, res) => {
    try {
      const { name, email } = req.body || {};
      if (name != null && typeof name === 'string' && name.trim().length >= 1 && name.trim().length <= 80) {
        db.users.updateName(req.user.id, name.trim());
      }
      if (email != null && typeof email === 'string' && /\S+@\S+\.\S+/.test(email)) {
        // Email change forces re-verification
        db.users.updateEmail(req.user.id, email.trim().toLowerCase());
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'update_failed', detail: e.message });
    }
  });

  router.delete('/account', (req, res) => {
    try {
      // Typed-confirmation required
      const confirm = (req.body && req.body.confirm) || (req.query && req.query.confirm);
      if (confirm !== 'DELETE') return res.status(400).json({ ok: false, reason: 'confirm_required', detail: 'POST body must include { confirm: "DELETE" }' });
      db.users.delete(req.user.id);
      // Clear session cookie
      if (auth && typeof auth._clearCookie === 'function') auth._clearCookie(res);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'delete_failed', detail: e.message });
    }
  });

  // ---- PREFERENCES ----
  router.get('/preferences', (req, res) => {
    try { res.json({ ok: true, preferences: db.prefs.get(req.user.id) }); }
    catch (e) { res.status(500).json({ ok: false, reason: 'prefs_failed', detail: e.message }); }
  });

  router.put('/preferences', (req, res) => {
    try {
      db.prefs.upsert({ user_id: req.user.id, ...req.body });
      res.json({ ok: true, preferences: db.prefs.get(req.user.id) });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'prefs_save_failed', detail: e.message });
    }
  });

  // ---- NOTIFICATIONS ----
  router.get('/notifications', (req, res) => {
    try {
      const n = db.notif.get(req.user.id);
      // Mask sealed tokens
      res.json({ ok: true, notifications: {
        email_enabled: !!n.email_enabled,
        email_digest_time: n.email_digest_time,
        telegram_enabled: !!n.telegram_enabled,
        telegram_chat_id: n.telegram_chat_id || '',
        telegram_bot_token_set: !!n.telegram_bot_token,
        webhook_enabled: !!n.webhook_enabled,
        webhook_url: n.webhook_url || '',
        webhook_secret_set: !!n.webhook_secret,
      }});
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'notif_failed', detail: e.message });
    }
  });

  router.put('/notifications', async (req, res) => {
    try {
      const b = req.body || {};
      // Only seal tokens if non-empty AND not the masked placeholder
      const sealedBot = (b.telegram_bot_token && b.telegram_bot_token !== '(unchanged)') ? await seal(b.telegram_bot_token) : null;
      const sealedSecret = (b.webhook_secret && b.webhook_secret !== '(unchanged)') ? await seal(b.webhook_secret) : null;
      db.notif.upsert({
        user_id: req.user.id,
        email_enabled: b.email_enabled,
        email_digest_time: b.email_digest_time || '16:00',
        telegram_enabled: b.telegram_enabled,
        telegram_bot_token: sealedBot,
        telegram_chat_id: b.telegram_chat_id || null,
        webhook_enabled: b.webhook_enabled,
        webhook_url: b.webhook_url || null,
        webhook_secret: sealedSecret,
      });
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'notif_save_failed', detail: e.message });
    }
  });

  // ---- EXPORT ----
  router.get('/export', (req, res) => {
    try {
      const u = db.users.byId(req.user.id);
      const brokers = db.brokers.list(req.user.id);
      const watchlist = db.watchlist.list(req.user.id);
      const paperState = db.paper.getState(req.user.id);
      const paperOrders = db.paper.listOrders(req.user.id);
      const autorun = db.autorun.get(req.user.id);
      const prefs = db.prefs.get(req.user.id);
      const notif = db.notif.get(req.user.id);
      const pnlRecent = db.pnl.recent(req.user.id, 365);
      const cronRecent = db.cron.recentByUser(req.user.id, 50);
      const exportData = {
        exported_at: new Date().toISOString(),
        ats_version: '2.4.1',
        user: { id: u.id, email: u.email, name: u.name, created_at: u.created_at },
        // Strip sealed secret fields from broker rows for portability
        brokers: brokers.map(r => ({ broker: r.broker, broker_user_id: r.broker_user_id, is_default: !!r.is_default, has_api_key: !!r.has_api_key, has_totp: !!r.has_totp, has_password: !!r.has_password })),
        watchlist, paper_state: paperState, paper_orders: paperOrders,
        autorun, preferences: prefs,
        notifications: { email_enabled: !!notif.email_enabled, telegram_enabled: !!notif.telegram_enabled, webhook_enabled: !!notif.webhook_enabled },
        pnl_recent: pnlRecent,
        cron_recent: cronRecent,
      };
      res.setHeader('Content-Disposition', `attachment; filename="ats-export-${u.id}-${Date.now()}.json"`);
      res.setHeader('Content-Type', 'application/json');
      res.send(JSON.stringify(exportData, null, 2));
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'export_failed', detail: e.message });
    }
  });

  return router;
}

module.exports = { createAccountRouter };

// admin-internal.js -- T-416 (architecture audit #1, server.js split #42).
// Two security-critical internal admin endpoints used by the host-side
// bulk-rotate script. Both gated by requireInternal() (loopback IP +
// X-ATS-Internal header) -- public callers cannot reach them.
//
//   - POST /api/admin/internal/bulk-rotate
//     Returns unsealed creds for every broker_accounts row marked
//     auto_reauth_enabled. Host script uses these to drive headless Kite
//     logins and then POSTs the resulting access_token back here.
//
//   - POST /api/admin/internal/seal-token
//     Seals + persists a freshly-rotated access_token for a single user.
//     Mirrors the cron-reauth (T-106) write path so any in-memory broker
//     re-hydration hooks fire identically.
//
// Spec coverage: internal-bulk-rotate.spec.js + internal-header-strip.spec.js
// exercise the gating + happy-path flow.

'use strict';

function mountAdminInternalRoutes(app, deps) {
  const { audit, requireInternal, getVault, getDb, express } = deps;
  if (typeof audit           !== 'function') throw new Error('admin-internal: audit required');
  if (typeof requireInternal !== 'function') throw new Error('admin-internal: requireInternal required');
  if (typeof getVault        !== 'function') throw new Error('admin-internal: getVault required');
  if (typeof getDb           !== 'function') throw new Error('admin-internal: getDb required');
  if (!express)                              throw new Error('admin-internal: express required');

  // ---------- POST /api/admin/internal/bulk-rotate ----------
  app.post('/api/admin/internal/bulk-rotate', express.json(), async (req, res) => {
    if (!requireInternal(req, res)) return;
    const vault = getVault();
    const db    = getDb();
    if (!vault) return res.status(503).json({ ok: false, reason: 'vault_not_open' });
    if (!db || !db.brokers || typeof db.brokers.listEligible !== 'function') {
      return res.status(503).json({ ok: false, reason: 'db_not_ready' });
    }
    try {
      const rows = db.brokers.listEligible() || [];
      const out = [];
      const errors = [];
      for (const r of rows) {
        try {
          const apiKey    = await vault.open(r.api_key);
          const apiSecret = await vault.open(r.refresh_token);
          const totpSeed  = await vault.open(r.totp_seed);
          const password  = await vault.open(r.feed_token);
          out.push({
            id:             r.id,
            user_id:        r.user_id,
            broker:         r.broker,
            broker_user_id: r.broker_user_id,
            api_key:        apiKey,
            api_secret:     apiSecret,
            totp_seed:      totpSeed,
            password:       password,
            login_url:      `https://kite.zerodha.com/connect/login?v=3&api_key=${encodeURIComponent(apiKey)}`,
          });
        } catch (e) {
          errors.push({ id: r.id, user_id: r.user_id, reason: 'unseal_failed', detail: String(e && e.message || e).slice(0, 200) });
        }
      }
      audit('bulkrotate.bundle.served', { count: out.length, errors: errors.length });
      res.json({ ok: true, count: out.length, accounts: out, errors });
    } catch (err) {
      audit('bulkrotate.bundle.error', { msg: err.message });
      res.status(500).json({ ok: false, error: err.message.slice(0, 200) });
    }
  });

  // ---------- POST /api/admin/internal/seal-token ----------
  app.post('/api/admin/internal/seal-token', express.json(), async (req, res) => {
    if (!requireInternal(req, res)) return;
    const vault = getVault();
    const db    = getDb();
    if (!vault) return res.status(503).json({ ok: false, reason: 'vault_not_open' });

    const body = req.body || {};
    const userId       = body.user_id;
    const rowId        = body.id;
    const accessToken  = body.access_token;
    if (!userId)      return res.status(400).json({ ok: false, reason: 'user_id_required' });
    if (!accessToken) return res.status(400).json({ ok: false, reason: 'access_token_required' });

    const issuedAt  = body.issued_at  || new Date().toISOString();
    const expiresAt = body.expires_at || new Date(Date.now() + 24*60*60*1000).toISOString();

    try {
      let row;
      if (rowId) {
        row = db.brokers.getFull(userId, rowId);
      } else {
        row = db.brokers.getByBroker(userId, 'zerodha');
      }
      if (!row) {
        audit('bulkrotate.seal.miss', { userId, rowId });
        return res.status(404).json({ ok: false, reason: 'broker_account_not_found' });
      }

      const sealed = await vault.seal(String(accessToken));
      db.brokers.updateTokens(row.id, userId, sealed, issuedAt, expiresAt);

      try {
        if (typeof db.brokers.recordTest === 'function') {
          db.brokers.recordTest(userId, row.id, true, null);
        }
      } catch (e) { console.warn('[admin-internal] swallowed:', e && e.message); }

      audit('bulkrotate.seal.ok', { userId, rowId: row.id, broker_user_id: row.broker_user_id });
      res.json({ ok: true, id: row.id, broker_user_id: row.broker_user_id, issued_at: issuedAt, expires_at: expiresAt });
    } catch (err) {
      audit('bulkrotate.seal.error', { userId, msg: err && err.message });
      res.status(500).json({ ok: false, error: String(err && err.message).slice(0, 200) });
    }
  });
}

module.exports = { mountAdminInternalRoutes };

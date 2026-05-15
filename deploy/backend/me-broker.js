// me-broker.js -- Tier 57: per-user broker credentials.
// Per-broker conventions for column reuse:
//   ZERODHA  api_key  -> sealed Kite api_key
//            refresh_token -> sealed Kite api_secret (Kite has no refresh token)
//            access_token  -> sealed daily access_token (rotated via OAuth callback)
//            totp_seed     -> sealed TOTP secret for auto-login (optional)
//            broker_user_id -> Kite client id (e.g. ARS209)

'use strict';

const SUPPORTED = new Set(['zerodha', 'dhan', 'angelone', 'upstox']);

function createMeBrokerRouter({ db, vault, requireAuth }) {
  const express = require('express');
  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));
  router.use(requireAuth);

  let invalidateCache;
  try { invalidateCache = require('./broker-resolver').invalidate; }
  catch (_) { invalidateCache = () => {}; }

  const seal = async (plain) => {
    if (plain == null || plain === '') return null;
    return vault.seal(String(plain));
  };

  // GET /api/me/broker -- list user's broker connections (no secrets)
  router.get('/', (req, res) => {
    try {
      const rows = db.brokers.list(req.user.id);
      res.json({
        ok: true,
        brokers: rows.map(r => ({
          id: r.id,
          broker: r.broker,
          broker_user_id: r.broker_user_id || '',
          is_default: !!r.is_default,
          issued_at: r.issued_at,
          expires_at: r.expires_at,
          created_at: r.created_at,
          has_api_key: !!r.has_api_key,
          has_access_token: !!r.has_access_token,
          has_totp: !!r.has_totp,
        })),
      });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'list_failed', detail: e.message });
    }
  });

  // POST /api/me/broker -- create or update
  router.post('/', async (req, res) => {
    try {
      const { broker, broker_user_id } = req.body || {};
      const api_key = req.body && req.body.api_key;
      const api_secret = req.body && req.body.api_secret;
      const totp_seed = req.body && req.body.totp_seed;
      const access_token = req.body && req.body.access_token;
      const set_default = !!(req.body && req.body.set_default);

      if (!broker || !SUPPORTED.has(String(broker).toLowerCase())) {
        return res.status(400).json({ ok: false, reason: 'broker_required', supported: Array.from(SUPPORTED) });
      }
      if (!broker_user_id || typeof broker_user_id !== 'string' || broker_user_id.length < 2) {
        return res.status(400).json({ ok: false, reason: 'broker_user_id_required' });
      }
      if (!api_key || typeof api_key !== 'string' || api_key.length < 4) {
        return res.status(400).json({ ok: false, reason: 'api_key_required' });
      }
      if (!api_secret || typeof api_secret !== 'string' || api_secret.length < 4) {
        return res.status(400).json({ ok: false, reason: 'api_secret_required' });
      }

      const row = {
        user_id: req.user.id,
        broker: String(broker).toLowerCase(),
        broker_user_id: String(broker_user_id),
        api_key: await seal(api_key),
        refresh_token: await seal(api_secret),
        totp_seed: totp_seed ? await seal(totp_seed) : null,
        access_token: access_token ? await seal(access_token) : null,
        is_default: set_default,
      };

      db.brokers.upsert(row);

      const existing = db.brokers.list(req.user.id);
      if (existing.length === 1 && !existing[0].is_default) {
        db.brokers.setDefault(req.user.id, existing[0].id);
      } else if (set_default) {
        const newRow = db.brokers.getByBroker(req.user.id, row.broker);
        if (newRow) db.brokers.setDefault(req.user.id, newRow.id);
      }

      invalidateCache(req.user.id);
      res.status(201).json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'save_failed', detail: e.message });
    }
  });

  // PUT /api/me/broker/:id -- patch fields
  router.put('/:id', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: 'bad_id' });

      const existing = db.brokers.getFull(req.user.id, id);
      if (!existing) return res.status(404).json({ ok: false, reason: 'not_found' });

      const patch = req.body || {};
      const row = {
        user_id: req.user.id,
        broker: existing.broker,
        broker_user_id: patch.broker_user_id || existing.broker_user_id,
        api_key: patch.api_key ? await seal(patch.api_key) : null,
        refresh_token: patch.api_secret ? await seal(patch.api_secret) : null,
        totp_seed: patch.totp_seed === '' ? null : (patch.totp_seed ? await seal(patch.totp_seed) : null),
        access_token: patch.access_token ? await seal(patch.access_token) : null,
        is_default: patch.is_default != null ? !!patch.is_default : !!existing.is_default,
      };

      db.brokers.upsert(row);
      if (patch.is_default === true) db.brokers.setDefault(req.user.id, id);

      invalidateCache(req.user.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'update_failed', detail: e.message });
    }
  });

  // DELETE /api/me/broker/:id -- remove
  router.delete('/:id', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: 'bad_id' });
      const result = db.brokers.delete(req.user.id, id);
      if (result.changes === 0) return res.status(404).json({ ok: false, reason: 'not_found' });
      invalidateCache(req.user.id);
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'delete_failed', detail: e.message });
    }
  });

  return router;
}

module.exports = { createMeBrokerRouter, SUPPORTED };

// me-broker.js -- Tier 57 + Tier 79: per-user broker credentials with auto-login.
// Per-broker conventions for column reuse:
//   ZERODHA  api_key       -> sealed Kite api_key
//            refresh_token -> sealed Kite api_secret (Kite has no refresh token)
//            access_token  -> sealed daily access_token (rotated via OAuth or auto-reauth)
//            totp_seed     -> sealed TOTP secret for headless auto-login (optional)
//            feed_token    -> sealed Kite password for headless auto-login (optional)
//            broker_user_id -> Kite client id (e.g. ARS209)

'use strict';

const http = require('http');

const SUPPORTED = new Set(['zerodha', 'dhan', 'angelone', 'upstox']);

// Tier 79: Unix-socket path the host-side auto-login daemon listens on.
// Bind-mounted into the container at /var/run/ats/auto-login.sock.
const DAEMON_SOCKET = process.env.AUTO_LOGIN_SOCKET || '/var/run/ats/auto-login.sock';
const DAEMON_AUTH_TOKEN = process.env.AUTO_LOGIN_TOKEN || '';

// Kite tokens are valid until 07:30 IST the morning after issuance.
function nextTokenExpiry(issuedAtIso) {
  const t = issuedAtIso ? new Date(issuedAtIso) : new Date();
  // Treat "07:30 IST" as 02:00 UTC.
  const target = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), 2, 0, 0));
  if (target <= t) target.setUTCDate(target.getUTCDate() + 1);
  return target;
}

function computeTokenStatus(row) {
  if (!row.has_access_token) return 'missing';
  const expiresAt = row.expires_at ? new Date(row.expires_at) : nextTokenExpiry(row.issued_at);
  const now = new Date();
  const minsLeft = (expiresAt - now) / 60000;
  if (minsLeft <= 0) return 'expired';
  if (minsLeft < 30) return 'expiring_soon';
  return 'valid';
}

// Talk to the host-side auto-login daemon over a Unix socket.
function callDaemon(payload, timeoutMs = 30000) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const req = http.request({
      socketPath: DAEMON_SOCKET,
      path: '/login',
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
        'x-ats-token': DAEMON_AUTH_TOKEN,
      },
      timeout: timeoutMs,
    }, (res) => {
      let chunks = '';
      res.on('data', (d) => { chunks += d; });
      res.on('end', () => {
        try { resolve(JSON.parse(chunks)); }
        catch (_) { resolve({ ok: false, reason: 'daemon_bad_json', detail: chunks.slice(0, 200) }); }
      });
    });
    req.on('error', (e) => {
      const reason = e.code === 'ENOENT' ? 'daemon_not_installed'
                   : e.code === 'ECONNREFUSED' ? 'daemon_down'
                   : 'daemon_error';
      resolve({ ok: false, reason, detail: e.message });
    });
    req.on('timeout', () => { req.destroy(); resolve({ ok: false, reason: 'daemon_timeout' }); });
    req.write(body);
    req.end();
  });
}

// Exchange a request_token for an access_token via Kite REST.
async function exchangeRequestToken({ apiKey, apiSecret, requestToken }) {
  const crypto = require('crypto');
  const checksum = crypto.createHash('sha256').update(apiKey + requestToken + apiSecret).digest('hex');
  const body = new URLSearchParams({ api_key: apiKey, request_token: requestToken, checksum }).toString();
  const https = require('https');
  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.kite.trade',
      path: '/session/token',
      method: 'POST',
      headers: {
        'X-Kite-Version': '3',
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': Buffer.byteLength(body),
      },
      timeout: 15000,
    }, (res) => {
      let buf = '';
      res.on('data', (d) => buf += d);
      res.on('end', () => {
        try {
          const j = JSON.parse(buf);
          if (j.status === 'success' && j.data && j.data.access_token) resolve(j.data.access_token);
          else reject(new Error(j.message || 'kite_session_failed'));
        } catch (e) { reject(new Error('kite_bad_response: ' + buf.slice(0, 100))); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('kite_timeout')); });
    req.write(body);
    req.end();
  });
}

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

  function decorateRow(r) {
    const tokenStatus = computeTokenStatus(r);
    const expiresAt = r.expires_at || (r.has_access_token ? nextTokenExpiry(r.issued_at).toISOString() : null);
    return {
      id: r.id,
      broker: r.broker,
      broker_user_id: r.broker_user_id || '',
      is_default: !!r.is_default,
      issued_at: r.issued_at,
      expires_at: expiresAt,
      created_at: r.created_at,
      has_api_key: !!r.has_api_key,
      has_access_token: !!r.has_access_token,
      has_totp: !!r.has_totp,
      has_password: !!r.has_password,
      token_status: tokenStatus,
      auto_login_capable: !!(r.has_api_key && r.has_totp && r.has_password),
      last_test_at: r.last_test_at || null,
      last_test_ok: r.last_test_ok == null ? null : !!r.last_test_ok,
      last_test_error: r.last_test_error || null,
    };
  }

  router.get('/', (req, res) => {
    try {
      const rows = db.brokers.list(req.user.id);
      res.json({ ok: true, brokers: rows.map(decorateRow) });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'list_failed', detail: e.message });
    }
  });

  router.post('/', async (req, res) => {
    try {
      const { broker, broker_user_id } = req.body || {};
      const api_key = req.body && req.body.api_key;
      const api_secret = req.body && req.body.api_secret;
      const totp_seed = req.body && req.body.totp_seed;
      const access_token = req.body && req.body.access_token;
      const password = req.body && req.body.password;
      const set_default = !!(req.body && req.body.set_default);
      const autoReauthAfterSave = !!(req.body && req.body.autoReauthAfterSave);

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
        feed_token: password ? await seal(password) : null,
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

      if (autoReauthAfterSave) {
        const fresh = db.brokers.getByBroker(req.user.id, row.broker);
        if (fresh && fresh.totp_seed && fresh.feed_token) {
          const result = await runAutoReauth({ db, vault, userId: req.user.id, brokerRow: fresh });
          return res.status(201).json({ ok: true, autoReauth: result });
        }
        return res.status(201).json({ ok: true, autoReauth: { ok: false, reason: 'no_totp_or_password' } });
      }

      res.status(201).json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'save_failed', detail: e.message });
    }
  });

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
        feed_token: patch.password === '' ? null : (patch.password ? await seal(patch.password) : null),
        is_default: patch.is_default != null ? !!patch.is_default : !!existing.is_default,
      };

      db.brokers.upsert(row);
      if (patch.is_default === true) db.brokers.setDefault(req.user.id, id);

      invalidateCache(req.user.id);

      if (patch.autoReauthAfterSave) {
        const fresh = db.brokers.getFull(req.user.id, id);
        if (fresh && fresh.totp_seed && fresh.feed_token) {
          const result = await runAutoReauth({ db, vault, userId: req.user.id, brokerRow: fresh });
          return res.json({ ok: true, autoReauth: result });
        }
        return res.json({ ok: true, autoReauth: { ok: false, reason: 'no_totp_or_password' } });
      }
      res.json({ ok: true });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'update_failed', detail: e.message });
    }
  });

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

  // Tier 79: POST /api/me/broker/test -- pure test that records last_test_*.
  router.post('/test', async (req, res) => {
    try {
      const broker = (req.body && req.body.broker) || 'zerodha';
      const row = db.brokers.getByBroker(req.user.id, broker);
      if (!row) return res.status(404).json({ ok: false, reason: 'not_configured' });
      let userBroker;
      try {
        const { getBrokerForUser } = require('./broker-resolver');
        userBroker = await getBrokerForUser({ db, vault }, req.user.id);
      } catch (e) {
        db.brokers.recordTest(req.user.id, row.id, false, 'resolver: ' + e.message);
        return res.status(500).json({ ok: false, reason: 'resolver_unavailable', detail: e.message });
      }
      if (!userBroker || !userBroker.kc) {
        db.brokers.recordTest(req.user.id, row.id, false, 'broker_not_initialised');
        return res.status(400).json({ ok: false, reason: 'broker_not_initialised' });
      }
      try {
        const profile = await userBroker.kc.getProfile();
        db.brokers.recordTest(req.user.id, row.id, true, null);
        res.json({ ok: true, profile: { user_id: profile.user_id, email: profile.email, broker: profile.broker } });
      } catch (e) {
        const msg = e && e.message ? e.message : 'test_failed';
        db.brokers.recordTest(req.user.id, row.id, false, msg);
        const reason = /token|access/i.test(msg) ? 'invalid_token' : /api_key/i.test(msg) ? 'invalid_api_key' : 'test_failed';
        res.status(400).json({ ok: false, reason, detail: msg });
      }
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'test_internal', detail: e.message });
    }
  });

  // Tier 79: POST /api/me/broker/auto-reauth -- one-click headless Kite login.
  router.post('/auto-reauth', async (req, res) => {
    try {
      const broker = (req.body && req.body.broker) || 'zerodha';
      const row = db.brokers.getByBroker(req.user.id, broker);
      if (!row) return res.status(404).json({ ok: false, reason: 'not_configured' });
      if (!row.totp_seed || !row.feed_token) {
        return res.status(400).json({ ok: false, reason: 'no_totp_or_password',
          detail: 'Add TOTP seed and Kite password in Edit credentials to enable auto-reauth.' });
      }
      const result = await runAutoReauth({ db, vault, userId: req.user.id, brokerRow: row });
      const code = result.ok ? 200 : 400;
      res.status(code).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'auto_reauth_internal', detail: e.message });
    }
  });

  return router;
}

async function runAutoReauth({ db, vault, userId, brokerRow }) {
  let apiKey, apiSecret, totpSeed, password;
  try {
    apiKey   = await vault.open(brokerRow.api_key);
    apiSecret = await vault.open(brokerRow.refresh_token);
    totpSeed = await vault.open(brokerRow.totp_seed);
    password = await vault.open(brokerRow.feed_token);
  } catch (e) {
    return { ok: false, reason: 'unseal_failed', detail: e.message };
  }
  if (!apiKey || !apiSecret || !totpSeed || !password) {
    return { ok: false, reason: 'missing_credential' };
  }

  const daemonResp = await callDaemon({
    api_key: apiKey,
    broker_user_id: brokerRow.broker_user_id,
    password, totp_seed: totpSeed,
  });
  if (!daemonResp.ok) {
    try { db.brokers.recordTest(userId, brokerRow.id, false, daemonResp.reason || 'daemon_failed'); } catch (_) {}
    return daemonResp;
  }
  const requestToken = daemonResp.request_token;
  if (!requestToken) return { ok: false, reason: 'daemon_no_request_token' };

  let accessToken;
  try {
    accessToken = await exchangeRequestToken({ apiKey, apiSecret, requestToken });
  } catch (e) {
    try { db.brokers.recordTest(userId, brokerRow.id, false, 'exchange_failed: ' + e.message); } catch (_) {}
    return { ok: false, reason: 'exchange_failed', detail: e.message };
  }

  try {
    const sealed = await vault.seal(accessToken);
    const issuedAt = new Date().toISOString();
    const expiresAt = nextTokenExpiry(issuedAt).toISOString();
    db.brokers.updateTokens(brokerRow.id, userId, sealed, issuedAt, expiresAt);
    db.brokers.recordTest(userId, brokerRow.id, true, null);
    try { require('./broker-resolver').invalidate(userId); } catch (_) {}
    return { ok: true, issuedAt, expiresAt };
  } catch (e) {
    return { ok: false, reason: 'persist_failed', detail: e.message };
  }
}

module.exports = {
  createMeBrokerRouter, SUPPORTED,
  _runAutoReauth: runAutoReauth,
  _nextTokenExpiry: nextTokenExpiry,
  _computeTokenStatus: computeTokenStatus,
};

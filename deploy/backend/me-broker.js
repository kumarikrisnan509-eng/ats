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
// T99-T113: returns { ok, accessToken | error } shape instead of throwing
// on Kite-rejection, so callers can read Kite's full structured response
// (error_type, message, status, http_status) for diagnostics. Network /
// timeout errors still throw.
async function exchangeRequestToken({ apiKey, apiSecret, requestToken }) {
  const crypto = require('crypto');
  const checksum = crypto.createHash('sha256').update(apiKey + requestToken + apiSecret).digest('hex');
  const body = new URLSearchParams({ api_key: apiKey, request_token: requestToken, checksum }).toString();
  const https = require('https');
  const t0 = Date.now();
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
        const httpStatus = res.statusCode;
        const elapsedMs = Date.now() - t0;
        let parsed = null;
        try { parsed = JSON.parse(buf); } catch (e) { console.debug('[me-broker] swallowed:', e && e.message); }
        if (parsed && parsed.status === 'success' && parsed.data && parsed.data.access_token) {
          resolve({ ok: true, accessToken: parsed.data.access_token, elapsedMs, httpStatus });
        } else {
          // Surface full Kite structured response so the caller can log/persist it.
          resolve({
            ok: false,
            elapsedMs, httpStatus,
            kiteStatus:    parsed && parsed.status    || null,
            kiteErrorType: parsed && parsed.error_type || null,
            kiteMessage:   parsed && parsed.message    || null,
            kiteRawBody:   buf.slice(0, 500),
          });
        }
      });
    });
    req.on('error', (e) => reject(new Error('kite_network_error: ' + e.message)));
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

  // Tier 80: PUT /api/me/broker/:id/auto-reauth-toggle -- enable/disable daily cron for this row.
  router.put('/:id/auto-reauth-toggle', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: 'bad_id' });
      const existing = db.brokers.getFull(req.user.id, id);
      if (!existing) return res.status(404).json({ ok: false, reason: 'not_found' });
      const enabled = !!(req.body && req.body.enabled);
      db.brokers.setAutoReauth(req.user.id, id, enabled);
      res.json({ ok: true, enabled });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'toggle_failed', detail: e.message });
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

// T99-T117: check if broker_accounts.issued_at has been updated to today in
// IST. The OAuth-callback handler at /api/v1/oauth/zerodha/callback writes
// here when Kite's redirect lands on our backend (which happens during the
// daemon's headless flow — Playwright's route.abort() loses the race). If
// the callback already exchanged the request_token, our own exchange would
// fail with TokenException because the request_token is single-use.
function _isRowFreshToday(db, userId, brokerId) {
  try {
    const row = db.brokers.getFull(userId, brokerId);
    if (!row || !row.issued_at) return false;
    const issued = new Date(row.issued_at);
    if (isNaN(issued.getTime())) return false;
    // Convert issued_at -> IST date.
    const istMs = issued.getTime() + (5.5 * 60 * 60 * 1000);
    const i = new Date(istMs);
    const issuedKey = `${i.getUTCFullYear()}-${String(i.getUTCMonth()+1).padStart(2,'0')}-${String(i.getUTCDate()).padStart(2,'0')}`;
    const now = new Date();
    const nowIstMs = now.getTime() + (5.5 * 60 * 60 * 1000);
    const n = new Date(nowIstMs);
    const nowKey = `${n.getUTCFullYear()}-${String(n.getUTCMonth()+1).padStart(2,'0')}-${String(n.getUTCDate()).padStart(2,'0')}`;
    return issuedKey === nowKey;
  } catch (_) { return false; }
}

// Poll the DB for up to maxMs (every stepMs) waiting for the OAuth-callback
// path to land a fresh issued_at. Returns true on success, false on timeout.
async function _waitForCallbackPath(db, userId, brokerId, maxMs = 4000, stepMs = 200) {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    if (_isRowFreshToday(db, userId, brokerId)) return true;
    await new Promise(r => setTimeout(r, stepMs));
  }
  return false;
}

async function runAutoReauth({ db, vault, userId, brokerRow }) {
  // T99-T113: per-step timing + full Kite error capture. The timings (in ms)
  // and Kite's structured error are included in result.timings/result.kite
  // so cron-reauth can persist them and ops can diagnose without redeploying.
  const timings = { unseal_ms: 0, daemon_ms: 0, exchange_ms: 0, persist_ms: 0 };
  let apiKey, apiSecret, totpSeed, password;
  const tUnseal = Date.now();
  try {
    apiKey   = await vault.open(brokerRow.api_key);
    apiSecret = await vault.open(brokerRow.refresh_token);
    totpSeed = await vault.open(brokerRow.totp_seed);
    password = await vault.open(brokerRow.feed_token);
  } catch (e) {
    return { ok: false, reason: 'unseal_failed', detail: e.message, timings };
  }
  timings.unseal_ms = Date.now() - tUnseal;
  if (!apiKey || !apiSecret || !totpSeed || !password) {
    return { ok: false, reason: 'missing_credential', timings };
  }

  const tDaemon = Date.now();
  const daemonResp = await callDaemon({
    api_key: apiKey,
    broker_user_id: brokerRow.broker_user_id,
    password, totp_seed: totpSeed,
  });
  timings.daemon_ms = Date.now() - tDaemon;
  if (!daemonResp.ok) {
    try { db.brokers.recordTest(userId, brokerRow.id, false, daemonResp.reason || 'daemon_failed'); } catch (e) { console.warn('[me-broker] swallowed:', e && e.message); }
    return { ...daemonResp, timings };
  }
  const requestToken = daemonResp.request_token;
  if (!requestToken) return { ok: false, reason: 'daemon_no_request_token', timings };

  // T99-T117: the OAuth callback at /api/v1/oauth/zerodha/callback receives
  // Kite's redirect while the daemon is still running and exchanges the
  // request_token ITSELF. Wait briefly to see if it already updated the DB —
  // if so, our exchange would fail with TokenException (token already
  // consumed) and we'd needlessly report 'exchange_failed' on a healthy
  // reauth. Saves the doomed Kite REST call AND fixes the misleading
  // cron_reauth_history.ok=0 status.
  const tWait = Date.now();
  const callbackOk = await _waitForCallbackPath(db, userId, brokerRow.id, 4000, 200);
  timings.callback_wait_ms = Date.now() - tWait;
  if (callbackOk) {
    // OAuth callback path already exchanged & persisted. Read fresh row to
    // get issued_at + expires_at for the return payload.
    const fresh = db.brokers.getFull(userId, brokerRow.id);
    try { db.brokers.recordTest(userId, brokerRow.id, true, null); } catch (e) { console.warn('[me-broker] swallowed:', e && e.message); }
    try { require('./broker-resolver').invalidate(userId); } catch (e) { console.warn('[me-broker] swallowed:', e && e.message); }
    return {
      ok: true,
      issuedAt: fresh && fresh.issued_at,
      expiresAt: fresh && fresh.expires_at,
      via: 'oauth_callback',
      timings,
    };
  }

  let exchangeResp;
  const tExchange = Date.now();
  try {
    exchangeResp = await exchangeRequestToken({ apiKey, apiSecret, requestToken });
  } catch (e) {
    timings.exchange_ms = Date.now() - tExchange;
    // Network / timeout level errors throw.
    try { db.brokers.recordTest(userId, brokerRow.id, false, 'exchange_failed: ' + e.message); } catch (e) { console.warn('[me-broker] swallowed:', e && e.message); }
    return { ok: false, reason: 'exchange_failed', detail: e.message, timings };
  }
  timings.exchange_ms = Date.now() - tExchange;
  if (!exchangeResp.ok) {
    // Kite rejected — surface full structured detail.
    const kite = {
      http_status:    exchangeResp.httpStatus,
      kite_status:    exchangeResp.kiteStatus,
      kite_error_type: exchangeResp.kiteErrorType,
      kite_message:   exchangeResp.kiteMessage,
      kite_raw_body:  exchangeResp.kiteRawBody,
    };
    const summary = `kite_${exchangeResp.kiteErrorType || 'unknown'}: ${exchangeResp.kiteMessage || 'no message'}`;
    try { db.brokers.recordTest(userId, brokerRow.id, false, 'exchange_failed: ' + summary); } catch (e) { console.warn('[me-broker] swallowed:', e && e.message); }
    return { ok: false, reason: 'exchange_failed', detail: summary, kite, timings };
  }
  const accessToken = exchangeResp.accessToken;

  const tPersist = Date.now();
  try {
    const sealed = await vault.seal(accessToken);
    const issuedAt = new Date().toISOString();
    const expiresAt = nextTokenExpiry(issuedAt).toISOString();
    // T-376: wrap token update + test record in a single SQLite transaction.
    // Without this, if updateTokens succeeds but recordTest throws (DB locked,
    // disk full, etc.) the token IS persisted but the function returns
    // 'persist_failed' to the caller. Operator manually re-runs reauth,
    // Zerodha rejects with TokenException ('token already exchanged') because
    // the persisted-but-not-acknowledged token is still valid. Atomicity
    // ensures both succeed or both rollback -- no half-state.
    db.transaction(() => {
      db.brokers.updateTokens(brokerRow.id, userId, sealed, issuedAt, expiresAt);
      db.brokers.recordTest(userId, brokerRow.id, true, null);
    });
    try { require('./broker-resolver').invalidate(userId); } catch (e) { console.warn('[me-broker] swallowed:', e && e.message); }
    timings.persist_ms = Date.now() - tPersist;
    return { ok: true, issuedAt, expiresAt, timings };
  } catch (e) {
    timings.persist_ms = Date.now() - tPersist;
    return { ok: false, reason: 'persist_failed', detail: e.message, timings };
  }
}

// ============================================================
// Tier 81: v1 API surface — RESTful, versioned, plural nouns, /actions/ for RPC verbs.
// Mounted at /api/v1/me/brokers from server.js. Reuses same handler logic internally.
// Old /api/me/broker* mount remains as a backward-compat alias for 30 days.
// ============================================================
function createV1BrokersRouter({ db, vault, requireAuth }) {
  const express = require('express');
  const router = express.Router();
  router.use(express.json({ limit: '32kb' }));
  router.use(requireAuth);

  // Re-use the same legacy router internally so handler bodies stay in one place.
  // We build a fresh handler factory that maps v1 paths to the same callbacks.
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
      id: r.id, broker: r.broker, broker_user_id: r.broker_user_id || '',
      is_default: !!r.is_default, issued_at: r.issued_at, expires_at: expiresAt,
      created_at: r.created_at,
      has_api_key: !!r.has_api_key, has_access_token: !!r.has_access_token,
      has_totp: !!r.has_totp, has_password: !!r.has_password,
      token_status: tokenStatus,
      auto_login_capable: !!(r.has_api_key && r.has_totp && r.has_password),
      last_test_at: r.last_test_at || null,
      last_test_ok: r.last_test_ok == null ? null : !!r.last_test_ok,
      last_test_error: r.last_test_error || null,
      auto_reauth_enabled: r.auto_reauth_enabled == null ? true : !!r.auto_reauth_enabled,
      cron_recent: (() => {
        try { return db.cron ? db.cron.recentByUser(r.user_id, 5) : []; }
        catch (_) { return []; }
      })(),
    };
  }

  // GET /api/v1/me/brokers
  router.get('/', (req, res) => {
    try {
      const rows = db.brokers.list(req.user.id);
      res.json({ ok: true, brokers: rows.map(decorateRow) });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'list_failed', detail: e.message });
    }
  });

  // POST /api/v1/me/brokers
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

      if (!broker || !SUPPORTED.has(String(broker).toLowerCase()))
        return res.status(400).json({ ok: false, reason: 'broker_required', supported: Array.from(SUPPORTED) });
      if (!broker_user_id || typeof broker_user_id !== 'string' || broker_user_id.length < 2)
        return res.status(400).json({ ok: false, reason: 'broker_user_id_required' });
      if (!api_key || typeof api_key !== 'string' || api_key.length < 4)
        return res.status(400).json({ ok: false, reason: 'api_key_required' });
      if (!api_secret || typeof api_secret !== 'string' || api_secret.length < 4)
        return res.status(400).json({ ok: false, reason: 'api_secret_required' });

      const row = {
        user_id: req.user.id, broker: String(broker).toLowerCase(),
        broker_user_id: String(broker_user_id),
        api_key: await seal(api_key), refresh_token: await seal(api_secret),
        totp_seed: totp_seed ? await seal(totp_seed) : null,
        access_token: access_token ? await seal(access_token) : null,
        feed_token: password ? await seal(password) : null,
        is_default: set_default,
      };
      db.brokers.upsert(row);
      const existing = db.brokers.list(req.user.id);
      if (existing.length === 1 && !existing[0].is_default) db.brokers.setDefault(req.user.id, existing[0].id);
      else if (set_default) {
        const r2 = db.brokers.getByBroker(req.user.id, row.broker);
        if (r2) db.brokers.setDefault(req.user.id, r2.id);
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

  // GET /api/v1/me/brokers/:id
  router.get('/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: 'bad_id' });
    const rows = db.brokers.list(req.user.id);
    const row = rows.find(r => r.id === id);
    if (!row) return res.status(404).json({ ok: false, reason: 'not_found' });
    res.json({ ok: true, broker: decorateRow(row) });
  });

  // PATCH /api/v1/me/brokers/:id  (was PUT in v0; PATCH is more correct for partial update)
  const patchHandler = async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return res.status(400).json({ ok: false, reason: 'bad_id' });
      const existing = db.brokers.getFull(req.user.id, id);
      if (!existing) return res.status(404).json({ ok: false, reason: 'not_found' });
      const patch = req.body || {};
      const row = {
        user_id: req.user.id, broker: existing.broker,
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
  };
  router.patch('/:id', patchHandler);
  router.put('/:id', patchHandler); // also accept PUT for client compatibility

  // DELETE /api/v1/me/brokers/:id
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

  // POST /api/v1/me/brokers/:id/actions/test  — pure connection test
  router.post('/:id/actions/test', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const row = db.brokers.getFull(req.user.id, id);
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

  // POST /api/v1/me/brokers/:id/actions/reauth  — one-click headless reauth
  router.post('/:id/actions/reauth', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const row = db.brokers.getFull(req.user.id, id);
      if (!row) return res.status(404).json({ ok: false, reason: 'not_configured' });
      if (!row.totp_seed || !row.feed_token)
        return res.status(400).json({ ok: false, reason: 'no_totp_or_password',
          detail: 'Add TOTP seed and password to enable headless reauth.' });
      const result = await runAutoReauth({ db, vault, userId: req.user.id, brokerRow: row });
      res.status(result.ok ? 200 : 400).json(result);
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'reauth_internal', detail: e.message });
    }
  });

  // GET /api/v1/me/brokers/:id/actions/reauth-url  — returns Kite OAuth URL for Manual flow
  router.get('/:id/actions/reauth-url', async (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const row = db.brokers.getFull(req.user.id, id);
      if (!row || !row.api_key)
        return res.status(412).json({ ok: false, reason: 'no_credentials', detail: 'Save api_key + api_secret first.' });
      const apiKey = await vault.open(row.api_key);
      // T-217: require the shared oauth-state module (was require('./server.js')._signState).
      const { signState } = require('./services/oauth-state');
      const state = signState(req.user.id);
      const url = `https://kite.zerodha.com/connect/login?api_key=${encodeURIComponent(apiKey)}&v=3&state=${encodeURIComponent(state)}`;
      res.json({ ok: true, url, expiresInSec: 300 });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'url_build_failed', detail: e.message });
    }
  });

  // PATCH /api/v1/me/brokers/:id/auto-reauth  { enabled: bool }
  router.patch('/:id/auto-reauth', (req, res) => {
    try {
      const id = parseInt(req.params.id, 10);
      const existing = db.brokers.getFull(req.user.id, id);
      if (!existing) return res.status(404).json({ ok: false, reason: 'not_found' });
      const enabled = !!(req.body && req.body.enabled);
      db.brokers.setAutoReauth(req.user.id, id, enabled);
      res.json({ ok: true, enabled });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'toggle_failed', detail: e.message });
    }
  });

  return router;
}

module.exports = {
  createMeBrokerRouter, createV1BrokersRouter, SUPPORTED,
  _runAutoReauth: runAutoReauth,
  _nextTokenExpiry: nextTokenExpiry,
  _computeTokenStatus: computeTokenStatus,
};

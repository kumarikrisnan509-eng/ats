// broker-oauth.js -- T-417 (architecture audit #1, server.js split #44 -- FINAL).
//
// SECURITY-CRITICAL. All 10 Zerodha OAuth handlers in one module. Most code
// here touches access tokens, session creation, and per-user credential
// unsealing. Preserved byte-for-byte from server.js T-416 (commit 3cbf309c)
// -- the only change is the wrapping in mountBrokerOAuthRoutes() and the
// substitution of singleton references for getter calls.
//
// Routes (in original source order):
//   - POST /api/brokers/zerodha/postback             (Kite order webhook,
//                                                     HMAC-verified, fans
//                                                     out to /ws + Telegram)
//   - POST /api/me/broker-test                       (Tier 64: user pings
//                                                     their own Kite via
//                                                     resolved per-user broker)
//   - GET  /api/me/broker-oauth-url                  (Tier 62: build per-user
//                                                     Kite login URL with
//                                                     HMAC-signed state)
//   - GET  /api/me/broker-callback                   (Tier 62 legacy alias of
//                                                     _zerodhaCallback)
//   - GET  /api/v1/oauth/zerodha/callback            (Tier 81 v1 alias)
//   - GET  /api/brokers/zerodha/login                (legacy global flow:
//                                                     redirect to Kite login)
//   - GET  /api/brokers/zerodha/callback             (legacy global callback,
//                                                     also accepts per-user
//                                                     when state= present)
//   - GET  /api/brokers/zerodha/auto-login/bundle    (loopback-only: host
//                                                     script fetches creds)
//   - POST /api/brokers/zerodha/auto-login/exchange  (loopback-only: host
//                                                     script returns request_token)
//   - POST /api/brokers/disconnect                   (clear per-user tokens)

'use strict';

const crypto = require('crypto');
const { LoginVault } = require('../login-vault');

function mountBrokerOAuthRoutes(app, deps) {
  const {
    BROKER_NAME,
    audit,
    notify,
    withAuth,
    requireInternal,
    setSessionCookie,
    readSessionCookie,
    signState,
    verifyState,
    getBroker,
    getVault,
    getDb,
    getSessions,
    getBrokerResolver,
    getWsClients,
    express,
  } = deps;
  if (typeof BROKER_NAME       !== 'string')   throw new Error('broker-oauth: BROKER_NAME required');
  if (typeof audit             !== 'function') throw new Error('broker-oauth: audit required');
  if (typeof notify            !== 'function') throw new Error('broker-oauth: notify required');
  if (typeof withAuth          !== 'function') throw new Error('broker-oauth: withAuth required');
  if (typeof requireInternal   !== 'function') throw new Error('broker-oauth: requireInternal required');
  if (typeof setSessionCookie  !== 'function') throw new Error('broker-oauth: setSessionCookie required');
  if (typeof readSessionCookie !== 'function') throw new Error('broker-oauth: readSessionCookie required');
  if (typeof signState         !== 'function') throw new Error('broker-oauth: signState required');
  if (typeof verifyState       !== 'function') throw new Error('broker-oauth: verifyState required');
  if (typeof getBroker         !== 'function') throw new Error('broker-oauth: getBroker required');
  if (typeof getVault          !== 'function') throw new Error('broker-oauth: getVault required');
  if (typeof getDb             !== 'function') throw new Error('broker-oauth: getDb required');
  if (typeof getSessions       !== 'function') throw new Error('broker-oauth: getSessions required');
  if (typeof getBrokerResolver !== 'function') throw new Error('broker-oauth: getBrokerResolver required');
  if (typeof getWsClients      !== 'function') throw new Error('broker-oauth: getWsClients required');
  if (!express)                                throw new Error('broker-oauth: express required');

  // ---------- POST /api/brokers/zerodha/postback (Kite order webhook) ----------
  app.post('/api/brokers/zerodha/postback', (req, res) => {
    const wsClients = getWsClients();
    const body = req.body || {};
    if (!body.order_id || !body.status || !body.checksum) {
      audit('postback.invalid', { reason: 'missing_required_fields', body });
      return res.status(400).json({ ok: false, reason: 'missing required fields' });
    }
    // T-424 (audit-2026-05-26 backend C2): timing-safe HMAC compare +
    // 60-s replay dedup. Old code used `!==` (timing leak) and had no
    // replay protection -- a captured postback could be re-sent
    // indefinitely, re-firing /ws fan-out + Telegram alerts.
    const expected = crypto
      .createHash('sha256')
      .update(String(body.order_id) + String(body.status) + (process.env.ZERODHA_API_SECRET || process.env.KITE_API_SECRET || ''))
      .digest('hex');
    const supplied = String(body.checksum || '').toLowerCase();
    let checksumOk = false;
    try {
      const expBuf = Buffer.from(expected, 'hex');
      const supBuf = Buffer.from(supplied, 'hex');
      checksumOk = expBuf.length === supBuf.length && crypto.timingSafeEqual(expBuf, supBuf);
    } catch (_) { checksumOk = false; }
    if (!checksumOk) {
      audit('postback.invalid', { reason: 'checksum_mismatch', orderId: body.order_id, status: body.status });
      return res.status(401).json({ ok: false, reason: 'checksum mismatch' });
    }
    // T-424 (C2): 60-s replay dedup keyed on order_id+status. Same status
    // for the same order arriving twice within 60s = replay attempt.
    const dedupKey = String(body.order_id) + '|' + String(body.status);
    const nowMs = Date.now();
    if (!global._atsPostbackSeen) global._atsPostbackSeen = new Map();
    const seenAt = global._atsPostbackSeen.get(dedupKey);
    if (seenAt && (nowMs - seenAt) < 60000) {
      audit('postback.replay', { reason: 'duplicate_within_60s', orderId: body.order_id, status: body.status, ageMs: nowMs - seenAt });
      return res.status(409).json({ ok: false, reason: 'replay' });
    }
    global._atsPostbackSeen.set(dedupKey, nowMs);
    // GC old entries when map grows.
    if (global._atsPostbackSeen.size > 1000) {
      for (const [k, t] of global._atsPostbackSeen) {
        if ((nowMs - t) > 300000) global._atsPostbackSeen.delete(k);
      }
    }
    audit('postback.received', {
      orderId: body.order_id, status: body.status, symbol: body.tradingsymbol,
      side: body.transaction_type, qty: body.filled_quantity, avg: body.average_price,
    });
    const payload = JSON.stringify({
      type: 'order_update',
      orderId:     body.order_id, status:      body.status,
      symbol:      body.tradingsymbol, exchange:    body.exchange,
      side:        body.transaction_type, quantity:    body.quantity,
      filledQty:   body.filled_quantity, pendingQty:  body.pending_quantity,
      price:       body.price, avgPrice:    body.average_price,
      statusMsg:   body.status_message, ts: Date.now(),
    });
    for (const ws of wsClients) {
      if (ws.readyState === 1) ws.send(payload);
    }
    const terminal = ['COMPLETE', 'REJECTED', 'CANCELLED'];
    if (terminal.includes(String(body.status).toUpperCase())) {
      const emoji = body.status === 'COMPLETE' ? 'success' : 'warn';
      notify(emoji, `Order ${body.status}: ${body.tradingsymbol}`, {
        body: body.status_message || '',
        fields: {
          orderId:  body.order_id, side: body.transaction_type,
          qty:      `${body.filled_quantity || 0} / ${body.quantity || 0}`,
          avgPrice: body.average_price || '-',
        },
      }).catch(e => console.warn('[broker-oauth] promise rejected:', e && e.message));
    }
    res.json({ ok: true, received: true });
  });

  // ---------- POST /api/me/broker-test (Tier 64) ----------
  app.post('/api/me/broker-test', withAuth(async (req, res) => {
    try {
      const _brokerResolver = getBrokerResolver();
      const db = getDb();
      const vault = getVault();
      if (!_brokerResolver) return res.status(503).json({ ok: false, reason: 'resolver_unavailable' });
      const r = await _brokerResolver.resolveForRequest({ db, vault, globalBroker: null, fallbackToGlobal: false }, req);
      if (!r.broker) return res.status(412).json({ ok: false, reason: 'broker_not_connected', detail: 'Save credentials first.' });
      const profile = await r.broker.getProfile();
      res.json({
        ok: true,
        profile: {
          userName: profile && (profile.user_name || profile.userName) || null,
          userEmail: profile && (profile.email || profile.userEmail) || null,
          broker: profile && (profile.broker || 'ZERODHA'),
          userId: profile && (profile.user_id || profile.userId) || null,
          segments: profile && (profile.exchanges || profile.segments) || [],
          products: profile && profile.products || [],
          orderTypes: profile && profile.order_types || profile.orderTypes || [],
        },
      });
    } catch (e) {
      const msg = e && e.message || 'unknown';
      const isTokenIssue = /token|access_token|TokenException|InputException/i.test(msg);
      res.status(isTokenIssue ? 401 : 500).json({
        ok: false,
        reason: isTokenIssue ? 'token_invalid' : 'profile_call_failed',
        detail: msg,
        hint: isTokenIssue ? 'Click Reauth to refresh your Kite access token.' : null,
      });
    }
  }));

  // ---------- GET /api/me/broker-oauth-url (Tier 62) ----------
  app.get('/api/me/broker-oauth-url', withAuth(async (req, res) => {
    try {
      const db = getDb();
      const vault = getVault();
      const row = db.brokers.getByBroker(req.user.id, 'zerodha');
      if (!row || !row.api_key) {
        return res.status(412).json({ ok: false, reason: 'no_credentials', detail: 'Save api_key + api_secret first.' });
      }
      const apiKey = await vault.open(row.api_key);
      const state = signState(req.user.id);
      const url = `https://kite.zerodha.com/connect/login?api_key=${encodeURIComponent(apiKey)}&v=3&state=${encodeURIComponent(state)}`;
      res.json({ ok: true, url, expiresInSec: 300 });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'url_build_failed', detail: e.message });
    }
  }));

  // ---------- _zerodhaCallback (shared by 2 aliases) ----------
  const _zerodhaCallback = async (req, res) => {
    const broker = getBroker();
    const vault  = getVault();
    const db     = getDb();
    const sessions = getSessions();
    const _brokerResolver = getBrokerResolver();
    const rt = req.query.request_token;
    const state = req.query.state;
    if (!rt) return res.status(400).send('Missing request_token.');

    // Stateless (global) flow -- T99-T58
    if (!state) {
      if (BROKER_NAME !== 'zerodha') return res.status(400).send('Not configured for Zerodha.');
      try {
        const session = await broker.exchangeRequestToken(rt);
        broker.setAccessToken(session.accessToken);
        await sessions.saveTokens(session.userId, {
          accessToken: session.accessToken,
          publicToken: session.publicToken,
          userId: session.userId,
          issuedAt: new Date().toISOString(),
        });
        try {
          let rows = [];
          try { rows = db.brokers.listEligible() || []; } catch (_) { rows = []; }
          const targetClientId = String(session.userId || '');
          for (const row of rows) {
            if (row.broker !== 'zerodha') continue;
            if (row.broker_user_id && targetClientId && row.broker_user_id !== targetClientId) continue;
            const sealed = await vault.seal(session.accessToken);
            const issuedAt = new Date().toISOString();
            const now = new Date();
            const expiresAt = new Date(now);
            expiresAt.setUTCHours(0, 30, 0, 0);
            if (expiresAt < now) expiresAt.setUTCDate(expiresAt.getUTCDate() + 1);
            db.brokers.updateTokens(row.id, row.user_id, sealed, issuedAt, expiresAt.toISOString());
            try { db.brokers.recordTest(row.user_id, row.id, true, null); } catch (e) { console.warn('[broker-oauth] swallowed:', e && e.message); }
            try { _brokerResolver.invalidate(row.user_id); } catch (e) { console.warn('[broker-oauth] swallowed:', e && e.message); }
            audit('zerodha.callback.db-sync', { userId: row.user_id, brokerRowId: row.id, kiteClientId: targetClientId });
            console.log('[broker-oauth] global-callback DB sync ok: row=' + row.id + ' user=' + row.user_id + ' kite=' + targetClientId);
          }
        } catch (e) {
          console.error('[broker-oauth] global-callback DB sync failed:', e && e.message);
        }
        const sid = sessions.newSession(session.userId);
        setSessionCookie(res, sid);
        audit('zerodha.connected.global-via-stateless-callback', { userId: session.userId });
        return res.redirect('/?connected=zerodha');
      } catch (err) {
        audit('zerodha.callback.global.error', { msg: err.message });
        return res.status(500).send(`Zerodha exchange failed: ${err.message}`);
      }
    }

    // Per-user path
    // T-424 (audit-2026-05-26 backend C1): bind state to req.user.id.
    // verifyState() now accepts an expectedUserId param; if it doesn't
    // match the state's embedded userId, return null. This prevents a
    // stolen state token from being replayed in another user's session.
    if (!req.user || !req.user.id) {
      audit('zerodha.callback.no-session', { hasState: !!state });
      return res.status(401).send('Login required to complete OAuth. Please sign in and retry from the Brokers screen.');
    }
    const userId = verifyState(state, req.user.id);
    if (!userId) {
      audit('zerodha.callback.state-mismatch', { sessionUserId: req.user.id });
      return res.status(400).send('Invalid, expired, or session-mismatched state token. Please retry from the Brokers screen.');
    }
    try {
      const row = db.brokers.getByBroker(userId, 'zerodha');
      if (!row) return res.status(404).send('No Zerodha credentials on file for this user.');
      const apiKey    = row.api_key      ? await vault.open(row.api_key)      : null;
      const apiSecret = row.refresh_token ? await vault.open(row.refresh_token) : null;
      if (!apiKey || !apiSecret) return res.status(412).send('Incomplete credentials.');
      const { KiteConnect } = require('kiteconnect');
      const kc = new KiteConnect({ api_key: apiKey });
      const session = await kc.generateSession(rt, apiSecret);
      const sealedAccessToken = await vault.seal(session.access_token);
      const now = new Date();
      const expiresAt = new Date(now);
      expiresAt.setUTCHours(0, 30, 0, 0);
      if (expiresAt < now) expiresAt.setUTCDate(expiresAt.getUTCDate() + 1);
      db.brokers.updateTokens(row.id, userId, sealedAccessToken, now.toISOString(), expiresAt.toISOString());
      if (session.user_id && !row.broker_user_id) {
        db._conn.prepare('UPDATE broker_accounts SET broker_user_id = ? WHERE id = ?').run(session.user_id, row.id);
      }
      try { _brokerResolver.invalidate(userId); } catch (e) { console.warn('[broker-oauth] swallowed:', e && e.message); }
      audit('zerodha.connected.per-user', { userId, kiteUserId: session.user_id });
      res.set('Content-Type', 'text/html');
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Zerodha connected</title>
<style>body{font-family:-apple-system,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f8fafc;color:#0f172a}.card{padding:32px;border-radius:12px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08);text-align:center}.ok{color:#059669;font-size:48px}h1{font-size:18px;margin:12px 0 4px}.muted{color:#64748b;font-size:13px}</style>
</head><body><div class="card"><div class="ok">&#10003;</div><h1>Zerodha connected</h1><div class="muted">You can close this window. Returning to ATS...</div></div>
<script>
  try { if (window.opener) window.opener.postMessage({ type: 'ats-broker-connected', broker: 'zerodha' }, '*'); } catch (e) { console.debug('[broker-oauth] error:', e && e.message); }
  setTimeout(() => { try { window.close(); } catch (e) { console.debug('[broker-oauth] error:', e && e.message); } window.location.href = '/#brokers?connected=1'; }, 1200);
</script></body></html>`);
    } catch (e) {
      audit('zerodha.callback.per-user.error', { userId, msg: e.message });
      res.status(500).set('Content-Type', 'text/html').send(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:24px"><h2>Connection failed</h2><p>${(e.message || 'unknown').replace(/[<>&]/g, '')}</p><p><a href="/#brokers">Back to Brokers</a></p></body></html>`);
    }
  };
  app.get('/api/me/broker-callback', _zerodhaCallback);          // legacy alias (Tier 62)
  app.get('/api/v1/oauth/zerodha/callback', _zerodhaCallback);   // v1 path (Tier 81)

  // ---------- GET /api/brokers/zerodha/login (legacy global flow) ----------
  app.get('/api/brokers/zerodha/login', (_req, res) => {
    if (BROKER_NAME !== 'zerodha') {
      return res.status(400).send('BROKER is not "zerodha" on this server.');
    }
    const broker = getBroker();
    const url = broker.buildLoginUrl();
    audit('zerodha.loginUrl', {});
    res.redirect(url);
  });

  // ---------- GET /api/brokers/zerodha/callback (legacy global + per-user) ----------
  app.get('/api/brokers/zerodha/callback', async (req, res) => {
    const broker = getBroker();
    const vault  = getVault();
    const db     = getDb();
    const sessions = getSessions();
    const _brokerResolver = getBrokerResolver();
    const rt = req.query.request_token;
    const state = req.query.state;
    if (!rt) return res.status(400).send('Missing request_token in callback.');

    // Per-user path (state present)
    if (state && typeof state === 'string' && state.split('.').length === 3) {
      // T-424 (audit-2026-05-26 backend C1): bind state to req.user.id.
      if (!req.user || !req.user.id) {
        audit('zerodha.callback.no-session', { hasState: true });
        return res.status(401).send('Login required to complete OAuth. Please sign in and retry from the Brokers screen.');
      }
      const userId = verifyState(state, req.user.id);
      if (!userId) {
        audit('zerodha.callback.state-mismatch', { sessionUserId: req.user.id });
        return res.status(400).send('Invalid, expired, or session-mismatched state token. Please retry from the Brokers screen.');
      }
      try {
        const row = db.brokers.getByBroker(userId, 'zerodha');
        if (!row) return res.status(404).send('No Zerodha credentials on file for this user.');
        const apiKey    = row.api_key      ? await vault.open(row.api_key)      : null;
        const apiSecret = row.refresh_token ? await vault.open(row.refresh_token) : null;
        if (!apiKey || !apiSecret) return res.status(412).send('Incomplete credentials.');
        const { KiteConnect } = require('kiteconnect');
        const kc = new KiteConnect({ api_key: apiKey });
        const session = await kc.generateSession(rt, apiSecret);
        const sealedAccessToken = await vault.seal(session.access_token);
        const now = new Date();
        const expiresAt = new Date(now);
        expiresAt.setUTCHours(0, 30, 0, 0);
        if (expiresAt < now) expiresAt.setUTCDate(expiresAt.getUTCDate() + 1);
        db.brokers.updateTokens(row.id, userId, sealedAccessToken, now.toISOString(), expiresAt.toISOString());
        if (session.user_id && !row.broker_user_id) {
          db._conn.prepare('UPDATE broker_accounts SET broker_user_id = ? WHERE id = ?').run(session.user_id, row.id);
        }
        try { _brokerResolver.invalidate(userId); } catch (e) { console.warn('[broker-oauth] swallowed:', e && e.message); }
        audit('zerodha.connected.per-user', { userId, kiteUserId: session.user_id });
        res.set('Content-Type', 'text/html');
        return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Zerodha connected</title>
<style>body{font-family:-apple-system,sans-serif;display:grid;place-items:center;height:100vh;margin:0;background:#f8fafc;color:#0f172a}.card{padding:32px;border-radius:12px;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,.08);text-align:center}.ok{color:#059669;font-size:48px}h1{font-size:18px;margin:12px 0 4px}.muted{color:#64748b;font-size:13px}</style>
</head><body><div class="card"><div class="ok">&#10003;</div><h1>Zerodha connected</h1><div class="muted">You can close this window. Returning to ATS...</div></div>
<script>
  try { if (window.opener) window.opener.postMessage({ type: 'ats-broker-connected', broker: 'zerodha' }, '*'); } catch (e) { console.debug('[broker-oauth] error:', e && e.message); }
  setTimeout(() => { try { window.close(); } catch (e) { console.debug('[broker-oauth] error:', e && e.message); } window.location.href = '/#brokers?connected=1'; }, 1200);
</script></body></html>`);
      } catch (err) {
        audit('zerodha.callback.per-user.error', { userId, msg: err.message });
        return res.status(500).set('Content-Type','text/html').send(`<html><body style="font-family:sans-serif;padding:24px"><h2>Connection failed</h2><p>${(err.message||'unknown').replace(/[<>&]/g,'')}</p><p><a href="/#brokers">Back to Brokers</a></p></body></html>`);
      }
    }

    // Legacy global path (no state)
    if (BROKER_NAME !== 'zerodha') return res.status(400).send('Not configured for Zerodha.');
    try {
      const session = await broker.exchangeRequestToken(rt);
      broker.setAccessToken(session.accessToken);
      await sessions.saveTokens(session.userId, {
        accessToken: session.accessToken,
        publicToken: session.publicToken,
        userId: session.userId,
        issuedAt: new Date().toISOString(),
      });
      const sid = sessions.newSession(session.userId);
      setSessionCookie(res, sid);
      audit('zerodha.connected', { userId: session.userId });
      res.redirect('/?connected=zerodha');
    } catch (err) {
      audit('zerodha.callback.error', { msg: err.message });
      res.status(500).send(`Zerodha exchange failed: ${err.message}`);
    }
  });

  // ---------- GET /api/brokers/zerodha/auto-login/bundle (loopback-only) ----------
  app.get('/api/brokers/zerodha/auto-login/bundle', async (req, res) => {
    if (!requireInternal(req, res)) return;
    if (BROKER_NAME !== 'zerodha') {
      return res.status(400).json({ ok: false, reason: 'broker_not_zerodha' });
    }
    try {
      const vault = getVault();
      const broker = getBroker();
      if (!vault) return res.status(503).json({ ok: false, reason: 'vault_not_open' });
      const lv = new LoginVault(vault);
      if (!lv.exists()) {
        return res.status(412).json({ ok: false, reason: 'no_creds_run_install_script' });
      }
      const creds = await lv.load();
      audit('autologin.bundle.served', { userId: creds.userId });
      res.json({
        ok: true,
        loginUrl: broker.buildLoginUrl(),
        userId:   creds.userId,
        password: creds.password,
        totpSeed: creds.totpSeed,
      });
    } catch (err) {
      audit('autologin.bundle.error', { msg: err.message });
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ---------- POST /api/brokers/zerodha/auto-login/exchange (loopback-only) ----------
  app.post('/api/brokers/zerodha/auto-login/exchange', express.json(), async (req, res) => {
    if (!requireInternal(req, res)) return;
    if (BROKER_NAME !== 'zerodha') {
      return res.status(400).json({ ok: false, reason: 'broker_not_zerodha' });
    }
    const rt = req.body && req.body.requestToken;
    if (!rt) return res.status(400).json({ ok: false, reason: 'missing_request_token' });
    try {
      const broker = getBroker();
      const sessions = getSessions();
      const session = await broker.exchangeRequestToken(rt);
      broker.setAccessToken(session.accessToken);
      await sessions.saveTokens(session.userId, {
        accessToken: session.accessToken,
        publicToken: session.publicToken,
        userId:      session.userId,
        issuedAt:    new Date().toISOString(),
      });
      audit('autologin.connected', { userId: session.userId });
      notify('success', 'ATS auto-login OK', {
        body: 'Kite session established. Ticker connecting.',
        fields: { userId: session.userId, time: new Date().toISOString() },
      }).catch(e => console.warn('[broker-oauth] promise rejected:', e && e.message));
      res.json({ ok: true, userId: session.userId });
    } catch (err) {
      audit('autologin.exchange.error', { msg: err.message });
      notify('error', 'ATS auto-login exchange FAILED', {
        body: err.message.slice(0, 200),
        url: 'https://ats.rajasekarselvam.com/api/brokers/zerodha/login',
      }).catch(e => console.warn('[broker-oauth] promise rejected:', e && e.message));
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ---------- POST /api/brokers/disconnect ----------
  app.post('/api/brokers/disconnect', async (req, res) => {
    const sessions = getSessions();
    const sid = readSessionCookie(req);
    if (!sid) return res.status(401).json({ ok: false });
    const uid = sessions.userIdFor(sid);
    if (uid) {
      await sessions.forgetTokens(uid);
      audit('zerodha.disconnect', { userId: uid });
    }
    res.json({ ok: true });
  });
}

module.exports = { mountBrokerOAuthRoutes };

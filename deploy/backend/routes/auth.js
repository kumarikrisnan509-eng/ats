// T-216 (CODE-AUDIT F.5 M1.4 piece 2): /api/auth/* handlers.
// T-228 (P0 FIX): rewired to use getter pattern.
//
// Why getters: server.js declares `let auth` at module scope and only assigns
// it inside `init()` which runs at the bottom of server.js (L5200+). All
// `app.post(...)` and `mountXxxRoutes(...)` calls execute at TOP LEVEL when
// server.js loads, BEFORE init() runs. If we destructure `{ auth, emailAlerts }`
// from the deps object at mount time we capture `undefined` permanently --
// the handlers then forever return "auth_not_initialized". This was a P0:
// prod /api/auth/login etc. have been broken since T-216 deployed.
//
// Fix: server.js now passes getters that close over the live `let` bindings.
// Handlers call `getAuth()` AT REQUEST time, getting the populated value.
//
// External deps (passed via mount function options):
//   getAuth         - () => auth (the auth module instance)
//   getEmailAlerts  - () => emailAlerts (the email module)

'use strict';

// T-374: in-memory signup rate-limiter. Caps signups at 5/hr/IP to block
// mass-signup spam. Same pattern as T-358's password-reset limiter in users.js
// (rolling window, NODE_ENV=test bypass for unit tests).
const _signupTimes = new Map();   // ip -> array of Date.now() timestamps
const SIGNUP_WINDOW_MS  = 60 * 60_000;
const SIGNUP_MAX_PER_WINDOW = 5;
function _signupRateOk(ip) {
  if (process.env.NODE_ENV === 'test') return true;
  const cutoff = Date.now() - SIGNUP_WINDOW_MS;
  const arr = (_signupTimes.get(ip) || []).filter(t => t > cutoff);
  if (arr.length >= SIGNUP_MAX_PER_WINDOW) {
    _signupTimes.set(ip, arr);
    return false;
  }
  arr.push(Date.now());
  _signupTimes.set(ip, arr);
  return true;
}

function mountAuthRoutes(app, deps) {
  const { getAuth, getEmailAlerts } = deps;

  app.post('/api/auth/signup', async (req, res) => {
    const auth = getAuth();
    const emailAlerts = getEmailAlerts();
    if (!auth) return res.status(503).json({ ok:false, reason:'auth_not_initialized' });
    // T-374: per-IP signup rate-limit (5/hr). Blocks mass-signup spam without
    // affecting legitimate users (single sign-up is rare per IP).
    const ip = req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || 'unknown';
    if (!_signupRateOk(ip)) {
      return res.status(429).json({ ok:false, reason:'rate_limit', detail:'Too many signup attempts. Try again later.' });
    }
    try {
      const { email, password, name } = req.body || {};
      const r = await auth.signup({ email, password, name });
      // T-377: pass the PLAINTEXT verifyToken (DB has only the hash now).
      // Without this, sendVerificationEmail can't build a working link.
      if (r.verifyToken && emailAlerts) {
        try { await auth.sendVerificationEmail({ user: r.user, baseUrl: req.protocol + '://' + req.headers.host, verifyTokenPlain: r.verifyToken }); }
        catch (_) {}
      }
      res.status(201).json({ ok:true, user: { id: r.user.id, email: r.user.email, name: r.user.name, is_verified: !!r.user.is_verified, is_admin: !!r.user.is_admin } });
    } catch (e) {
      res.status(400).json({ ok:false, reason: e.message });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const auth = getAuth();
    if (!auth) return res.status(503).json({ ok:false, reason:'auth_not_initialized' });
    try {
      const { email, password } = req.body || {};
      const r = await auth.login({
        email, password,
        ip: req.headers['x-real-ip'] || (req.socket && req.socket.remoteAddress) || '',
        ua: req.headers['user-agent'] || '',
      });
      auth._setCookie(res, r.sessionId);
      res.json({ ok:true, user: { id: r.user.id, email: r.user.email, name: r.user.name, is_verified: !!r.user.is_verified, is_admin: !!r.user.is_admin }, expiresAt: r.expiresAt });
    } catch (e) {
      res.status(401).json({ ok:false, reason: e.message });
    }
  });

  app.post('/api/auth/logout', (req, res) => {
    const auth = getAuth();
    if (auth && req.sessionId) auth.logout(req.sessionId);
    if (auth) auth._clearCookie(res);
    res.json({ ok:true });
  });

  app.get('/api/auth/me', (req, res) => {
    if (!req.user) return res.status(401).json({ ok:false, reason:'auth_required' });
    res.json({ ok:true, user: req.user });
  });

  app.post('/api/auth/verify-email', async (req, res) => {
    const auth = getAuth();
    if (!auth) return res.status(503).json({ ok:false, reason:'auth_not_initialized' });
    try {
      const { token } = req.body || {};
      const r = await auth.verifyEmail(token);
      res.json({ ok:true, alreadyVerified: r.alreadyVerified });
    } catch (e) {
      res.status(400).json({ ok:false, reason: e.message });
    }
  });

  app.post('/api/auth/forgot-password', async (req, res) => {
    const auth = getAuth();
    if (!auth) return res.status(503).json({ ok:false, reason:'auth_not_initialized' });
    const { email } = req.body || {};
    const r = await auth.requestPasswordReset({ email, baseUrl: req.protocol + '://' + req.headers.host });
    // Don't leak whether email was found
    res.json({ ok:true, sent: r.sent });
  });

  app.post('/api/auth/reset-password', async (req, res) => {
    const auth = getAuth();
    if (!auth) return res.status(503).json({ ok:false, reason:'auth_not_initialized' });
    try {
      const { token, newPassword } = req.body || {};
      await auth.resetPassword({ token, newPassword });
      res.json({ ok:true });
    } catch (e) {
      res.status(400).json({ ok:false, reason: e.message });
    }
  });
}

module.exports = { mountAuthRoutes };

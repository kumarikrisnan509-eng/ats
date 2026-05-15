// users.js -- Tier 50: signup, login, logout, session middleware, bcrypt.
//
// Wraps deploy/backend/db.js. All persistence goes through the SQLite users +
// user_sessions tables. Sessions are HttpOnly cookies; the cookie value is
// the session id (random 32-byte hex), the actual user identity lives in the DB.
//
// Account safety:
//   - bcrypt cost 12 (~250ms on Ampere A1, slow enough to defeat offline brute)
//   - after 5 failed logins in a row, account locked 15 minutes
//   - first signup auto-promotes to admin + auto-verified (single-VM bootstrap)
//   - verification token is a random 32-byte hex sent by email (Tier 51)
//
// Public API (factory):
//   const auth = createUsers({ db, emailAlerts, audit });
//   await auth.signup({ email, password, name })  -> { user, verifyToken }
//   await auth.login({ email, password, ip, ua }) -> { sessionId, user, expiresAt }
//   auth.logout(sessionId)
//   auth.requireAuth(req, res, next)              -- express middleware
//   auth.optionalAuth(req, res, next)             -- attaches req.user if cookie present

'use strict';

const crypto = require('crypto');

let bcrypt;
try { bcrypt = require('bcrypt'); }
catch (_) { bcrypt = null; }

const BCRYPT_COST    = Number(process.env.BCRYPT_COST || 12);
const SESSION_TTL_MS = Number(process.env.SESSION_TTL_MS) || 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_NAME    = 'ats_sid';
const MAX_FAILED     = 5;
const LOCK_DURATION_MS = 15 * 60 * 1000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;

function _now() { return new Date().toISOString().slice(0, 19).replace('T', ' '); }
function _later(ms) { return new Date(Date.now() + ms).toISOString().slice(0, 19).replace('T', ' '); }
function _hex(n) { return crypto.randomBytes(n).toString('hex'); }

function _parseCookie(header, name) {
  if (!header) return null;
  for (const part of header.split(/;\s*/)) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    if (part.slice(0, eq) === name) return decodeURIComponent(part.slice(eq + 1));
  }
  return null;
}
function _setCookie(res, name, value, opts = {}) {
  const parts = [`${name}=${value}`, 'HttpOnly', 'SameSite=Lax', 'Path=/'];
  if (opts.maxAge)  parts.push(`Max-Age=${Math.floor(opts.maxAge / 1000)}`);
  if (opts.secure)  parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}
function _clearCookie(res, name) {
  res.setHeader('Set-Cookie', `${name}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function createUsers({ db, emailAlerts, audit, secureCookie }) {
  if (!db) throw new Error('users: db required');
  if (!bcrypt) console.warn('users: bcrypt not installed -- signup/login will fail');

  const isFirstUser = () => db.users.count() === 0;

  async function signup({ email, password, name }) {
    email = String(email || '').toLowerCase().trim();
    password = String(password || '');
    name = String(name || '').trim();
    if (!EMAIL_RE.test(email))      throw new Error('invalid email');
    if (password.length < PASSWORD_MIN) throw new Error(`password must be at least ${PASSWORD_MIN} chars`);
    if (db.users.byEmail(email))    throw new Error('email already registered');

    if (!bcrypt) throw new Error('bcrypt not installed on server');
    const password_hash = await bcrypt.hash(password, BCRYPT_COST);
    const verification_token = _hex(32);
    const first = isFirstUser();

    const r = db.users.create({
      email, password_hash, name: name || null,
      verification_token,
      verification_sent_at: _now(),
    });
    const userId = r.lastInsertRowid;

    if (first) {
      // Bootstrap: first user is admin + auto-verified (the operator).
      db.users.promoteFirstToAdmin();
      if (audit) try { audit('user.bootstrap_admin', { userId, email }); } catch (_) {}
    }
    if (audit) try { audit('user.signup', { userId, email, bootstrap: first }); } catch (_) {}

    return {
      user: db.users.byId(userId),
      verifyToken: first ? null : verification_token,   // first user doesn't need verify
    };
  }

  async function login({ email, password, ip, ua }) {
    email = String(email || '').toLowerCase().trim();
    password = String(password || '');
    const u = db.users.byEmail(email);
    if (!u) {
      // constant-time hash to slow down email enumeration
      if (bcrypt) await bcrypt.compare(password, '$2b$12$' + 'a'.repeat(53));
      throw new Error('invalid credentials');
    }
    if (u.locked_until && u.locked_until > _now()) {
      throw new Error(`account locked until ${u.locked_until} UTC`);
    }
    if (!u.is_active) throw new Error('account disabled');

    if (!bcrypt) throw new Error('bcrypt not installed on server');
    const ok = await bcrypt.compare(password, u.password_hash);
    if (!ok) {
      db.users.bumpFailed(u.id);
      if (audit) try { audit('user.login.failed', { userId: u.id, email }); } catch (_) {}
      if ((u.failed_logins || 0) + 1 >= MAX_FAILED) {
        db.users.lock(u.id, _later(LOCK_DURATION_MS));
        throw new Error('too many failed attempts -- account locked 15 minutes');
      }
      throw new Error('invalid credentials');
    }

    db.users.touchLogin(u.id);
    const sessionId = _hex(32);
    const expiresAt = _later(SESSION_TTL_MS);
    db.sessions.create(sessionId, u.id, expiresAt, ip || '', (ua || '').slice(0, 256));

    if (audit) try { audit('user.login.ok', { userId: u.id, email, ip }); } catch (_) {}
    return { sessionId, user: db.users.byId(u.id), expiresAt };
  }

  function logout(sessionId) {
    if (!sessionId) return;
    db.sessions.delete(sessionId);
    if (audit) try { audit('user.logout', { sessionId: sessionId.slice(0, 8) + '...' }); } catch (_) {}
  }

  function getSession(sessionId) {
    if (!sessionId) return null;
    return db.sessions.get(sessionId) || null;
  }

  // Express middleware
  function optionalAuth(req, res, next) {
    const sid = _parseCookie(req.headers.cookie, COOKIE_NAME);
    if (sid) {
      const s = getSession(sid);
      if (s) {
        req.user = {
          id: s.user_id, email: s.email, name: s.name,
          is_admin: !!s.is_admin, is_verified: !!s.is_verified,
        };
        req.sessionId = sid;
      }
    }
    next();
  }
  function requireAuth(req, res, next) {
    if (!req.user) return res.status(401).json({ ok: false, reason: 'auth_required' });
    next();
  }
  function requireAdmin(req, res, next) {
    if (!req.user)         return res.status(401).json({ ok: false, reason: 'auth_required' });
    if (!req.user.is_admin) return res.status(403).json({ ok: false, reason: 'admin_only' });
    next();
  }

  return {
    signup, login, logout, getSession,
    optionalAuth, requireAuth, requireAdmin,
    _setCookie: (res, sid) => _setCookie(res, COOKIE_NAME, sid, { maxAge: SESSION_TTL_MS, secure: !!secureCookie }),
    _clearCookie: (res) => _clearCookie(res, COOKIE_NAME),
    COOKIE_NAME, SESSION_TTL_MS,
  };
}

module.exports = { createUsers, COOKIE_NAME: 'ats_sid' };

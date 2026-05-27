// T-217 (CODE-AUDIT F.5 M1.4 piece 3 + A.2 fix): OAuth state-signer.
//
// Extracts the inline HMAC-signed-state helpers that lived in server.js for
// the Zerodha OAuth login flow. The state token combines the user's id with
// a single-use nonce, signed with SESSION_SECRET. Used during the
// /api/v1/me/brokers/:id/actions/reauth-url -> Zerodha redirect -> callback
// round-trip.
//
// IMPORTANT (audit §A.2 fix): me-broker.js previously did
//   require('./server.js')._signState
// to reach back into server.js for this helper. server.js never exports
// _signState (it's a module-local function), so me-broker.js's import was
// undefined, and its `if (!signState)` fallback at line 723-730 of
// me-broker.js was self-acknowledged as broken ('the callback will fail').
// This module gives both server.js and me-broker.js a real shared dep,
// eliminating the broken circular require.
//
// Public API:
//   const oauth = require('./services/oauth-state');
//   const state = oauth.signState(userId);    // returns base64.base64.hex
//   const userId = oauth.verifyState(state);  // returns id or null
//   oauth._pendingNonces                       // exposed for testing only

'use strict';

const crypto = require('crypto');

const _pendingNonces = new Map(); // nonce -> { userId, exp }
const SESSION_SECRET = process.env.SESSION_SECRET || 'dev-only-change-me';

// T-474 (audit-2026-05-26 backend H10): hard prod safeguard.
// In production, refuse to load if SESSION_SECRET is missing or still the dev
// placeholder. Without this, an operator that fat-fingers the env file would
// silently get a deployment where every OAuth state token is HMAC'd with a
// publicly-known key -- meaning anyone can forge a valid `state` and complete
// the OAuth callback as ANY user. Caught at module load, not first request,
// so the container fails to start (deploy.yml's health-check then refuses to
// promote the new image and the previous good container keeps serving).
// Dev/test deploys (NODE_ENV !== 'production') keep the convenience fallback.
if (process.env.NODE_ENV === 'production') {
  const _ss = process.env.SESSION_SECRET;
  if (!_ss || _ss === 'dev-only-change-me' || _ss.length < 32) {
    // eslint-disable-next-line no-console
    console.error('[oauth-state] FATAL: SESSION_SECRET missing, dev-default, or <32 chars in production. Refusing to start.');
    process.exit(78); // EX_CONFIG -- matches server.js convention.
  }
}

function signState(userId) {
  const nonce = crypto.randomBytes(12).toString('hex');
  const idB64 = Buffer.from(String(userId)).toString('base64').replace(/=+$/,'');
  const nonceB64 = Buffer.from(nonce).toString('base64').replace(/=+$/,'');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(`${userId}|${nonce}`).digest('hex');
  _pendingNonces.set(nonce, { userId, exp: Date.now() + 5 * 60 * 1000 });
  // T-451 (audit-2026-05-26 backend L10): GC threshold env-tunable.
  // Default 100 is fine for single-operator; multi-tenant deploys with
  // many concurrent OAuth flows can raise via OAUTH_NONCE_GC_AT env.
  if (_pendingNonces.size > (Number(process.env.OAUTH_NONCE_GC_AT) || 100)) {
    const now = Date.now();
    for (const [k, v] of _pendingNonces) if (v.exp < now) _pendingNonces.delete(k);
  }
  return `${idB64}.${nonceB64}.${sig}`;
}

// T-434 (audit-2026-05-26 backend M2): sweep expired nonces on every
// verifyState call too, not just signState. Otherwise an abandoned-OAuth
// flow (signState fires but verifyState never gets called because the
// user closed the popup) leaks memory until the next signState.
function _gcExpiredNonces() {
  const now = Date.now();
  for (const [k, v] of _pendingNonces) if (v.exp < now) _pendingNonces.delete(k);
}

function verifyState(state, expectedUserId) {
  _gcExpiredNonces();
  // T-424 (audit-2026-05-26 backend C1): added timing-safe sig compare and
  // an OPTIONAL expectedUserId binding. If expectedUserId is provided (e.g.
  // req.user.id from session), the state's embedded userId must match it
  // exactly -- otherwise this is a STOLEN state token being replayed from
  // another user's session. Callers MUST pass expectedUserId in OAuth
  // callback handlers (broker-oauth.js); legacy callers without a session
  // (auto-login daemon) can omit it.
  if (!state || typeof state !== 'string') return null;
  try {
    const [idB64, nonceB64, sig] = state.split('.');
    if (!idB64 || !nonceB64 || !sig) return null;
    const userId = Buffer.from(idB64, 'base64').toString();
    const nonce = Buffer.from(nonceB64, 'base64').toString();
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(`${userId}|${nonce}`).digest('hex');
    // Timing-safe compare. Lengths can differ when sig is malformed; treat
    // length mismatch as failure (timingSafeEqual throws if lengths differ).
    const sigBuf = Buffer.from(sig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return null;
    }
    const rec = _pendingNonces.get(nonce);
    if (!rec) return null;
    if (rec.exp < Date.now()) { _pendingNonces.delete(nonce); return null; }
    // T-424 (C1): if caller passed expectedUserId, enforce session binding.
    if (expectedUserId != null && String(expectedUserId) !== String(userId)) {
      // Do NOT delete the nonce -- keep it usable for the legitimate session.
      // Just refuse this caller.
      return null;
    }
    _pendingNonces.delete(nonce); // single use
    return userId;
  } catch (_) {
    return null;
  }
}

module.exports = { signState, verifyState, _pendingNonces };

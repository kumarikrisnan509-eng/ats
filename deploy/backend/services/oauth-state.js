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

function signState(userId) {
  const nonce = crypto.randomBytes(12).toString('hex');
  const idB64 = Buffer.from(String(userId)).toString('base64').replace(/=+$/,'');
  const nonceB64 = Buffer.from(nonce).toString('base64').replace(/=+$/,'');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(`${userId}|${nonce}`).digest('hex');
  _pendingNonces.set(nonce, { userId, exp: Date.now() + 5 * 60 * 1000 });
  // Gc expired entries when the map grows.
  if (_pendingNonces.size > 100) {
    const now = Date.now();
    for (const [k, v] of _pendingNonces) if (v.exp < now) _pendingNonces.delete(k);
  }
  return `${idB64}.${nonceB64}.${sig}`;
}

function verifyState(state) {
  if (!state || typeof state !== 'string') return null;
  try {
    const [idB64, nonceB64, sig] = state.split('.');
    if (!idB64 || !nonceB64 || !sig) return null;
    const userId = Buffer.from(idB64, 'base64').toString();
    const nonce = Buffer.from(nonceB64, 'base64').toString();
    const expected = crypto.createHmac('sha256', SESSION_SECRET).update(`${userId}|${nonce}`).digest('hex');
    if (sig !== expected) return null;
    const rec = _pendingNonces.get(nonce);
    if (!rec) return null;
    if (rec.exp < Date.now()) { _pendingNonces.delete(nonce); return null; }
    _pendingNonces.delete(nonce); // single use
    return userId;
  } catch (_) {
    return null;
  }
}

module.exports = { signState, verifyState, _pendingNonces };

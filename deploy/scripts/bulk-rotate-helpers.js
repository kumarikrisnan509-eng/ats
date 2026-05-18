// bulk-rotate-helpers.js — pure-logic helpers extracted from bulk-rotate.js
// (T-138) so they can be unit-tested without requiring playwright / otplib /
// node-fetch at module load time. The host script consumes these via require()
// and adds the I/O on top.

'use strict';

const crypto = require('crypto');

/**
 * Compute Kite Connect's session-token checksum.
 *
 * Per Kite docs:
 *   checksum = sha256(api_key + request_token + api_secret), hex-encoded
 *
 * @param {string} apiKey       Kite API key
 * @param {string} requestToken One-time token from the OAuth redirect
 * @param {string} apiSecret    Kite API secret
 * @returns {string} 64-char lowercase hex digest
 */
function checksum(apiKey, requestToken, apiSecret) {
  if (typeof apiKey !== 'string' || apiKey.length === 0)         throw new Error('checksum: apiKey required');
  if (typeof requestToken !== 'string' || requestToken.length === 0) throw new Error('checksum: requestToken required');
  if (typeof apiSecret !== 'string' || apiSecret.length === 0)   throw new Error('checksum: apiSecret required');
  return crypto.createHash('sha256')
    .update(apiKey + requestToken + apiSecret)
    .digest('hex');
}

/**
 * Build the form-urlencoded body for POST /session/token.
 *
 * @param {{api_key:string, request_token:string, api_secret:string}} input
 * @returns {URLSearchParams}
 */
function buildExchangeBody({ api_key, request_token, api_secret }) {
  if (!api_key)       throw new Error('buildExchangeBody: api_key required');
  if (!request_token) throw new Error('buildExchangeBody: request_token required');
  if (!api_secret)    throw new Error('buildExchangeBody: api_secret required');
  return new URLSearchParams({
    api_key,
    request_token,
    checksum: checksum(api_key, request_token, api_secret),
  });
}

/**
 * Pull the `request_token` query param out of a Kite redirect URL.
 * Returns null on any parse error.
 *
 * @param {string} redirectUrl
 * @returns {string|null}
 */
function extractRequestToken(redirectUrl) {
  if (typeof redirectUrl !== 'string' || !redirectUrl) return null;
  try {
    const u = new URL(redirectUrl);
    return u.searchParams.get('request_token');
  } catch (_) {
    return null;
  }
}

module.exports = {
  checksum,
  buildExchangeBody,
  extractRequestToken,
};

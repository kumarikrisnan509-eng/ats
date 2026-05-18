// bulk-rotate-helpers.test.js — T-145 regression guard for T-138 helpers.
//
// The bulk-rotate.js host script handles real Kite credentials in the daily
// rotation cron. A bug in the checksum formula silently makes every user's
// exchange call fail with 'token_invalid' — the operator only finds out
// when broker_status flips red across the whole user base the next morning.
//
// These tests exercise the pure helpers (no network, no playwright, no otplib)
// so CI can catch regressions in seconds.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { checksum, buildExchangeBody, extractRequestToken } =
  require('../../scripts/bulk-rotate-helpers');

// ---------- checksum ----------

test('checksum matches Kite spec: sha256(api_key + request_token + api_secret)', () => {
  const a = 'abc123';
  const r = 'tok_xyz';
  const s = 'sec_qqq';
  const expected = crypto.createHash('sha256').update('abc123tok_xyzsec_qqq').digest('hex');
  assert.equal(checksum(a, r, s), expected);
});

test('checksum is deterministic + 64 lowercase hex chars', () => {
  const a = checksum('k1', 'r1', 's1');
  const b = checksum('k1', 'r1', 's1');
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.match(a, /^[0-9a-f]{64}$/);
});

test('checksum order matters (api_key + request_token + api_secret, NOT alphabetical)', () => {
  // If someone "fixes" the helper to sort args, every Kite exchange call
  // would silently fail. Lock the concatenation order.
  const ordered    = checksum('aaa', 'bbb', 'ccc');
  const reordered  = checksum('bbb', 'ccc', 'aaa');
  assert.notEqual(ordered, reordered);
});

test('checksum rejects empty / missing args', () => {
  assert.throws(() => checksum('', 'r', 's'), /apiKey required/);
  assert.throws(() => checksum('a', '', 's'), /requestToken required/);
  assert.throws(() => checksum('a', 'r', ''), /apiSecret required/);
  assert.throws(() => checksum(null, 'r', 's'));
  assert.throws(() => checksum('a', undefined, 's'));
});

// ---------- buildExchangeBody ----------

test('buildExchangeBody emits api_key + request_token + checksum form fields', () => {
  const body = buildExchangeBody({ api_key: 'k', request_token: 'r', api_secret: 's' });
  assert.ok(body instanceof URLSearchParams);
  assert.equal(body.get('api_key'), 'k');
  assert.equal(body.get('request_token'), 'r');
  assert.equal(body.get('checksum'), checksum('k', 'r', 's'));
});

test('buildExchangeBody URL-encodes special chars correctly', () => {
  // Kite api_keys and tokens are usually [A-Za-z0-9] but be defensive.
  const body = buildExchangeBody({
    api_key:       'key with spaces',
    request_token: 'tok+plus=eq&amp',
    api_secret:    's',
  });
  const serialized = body.toString();
  // toString() URL-encodes per application/x-www-form-urlencoded.
  assert.ok(serialized.includes('api_key=key+with+spaces'));
  assert.ok(serialized.includes('request_token=tok%2Bplus%3Deq%26amp'));
});

test('buildExchangeBody rejects missing fields', () => {
  assert.throws(() => buildExchangeBody({ request_token: 'r', api_secret: 's' }), /api_key required/);
  assert.throws(() => buildExchangeBody({ api_key: 'k', api_secret: 's' }),       /request_token required/);
  assert.throws(() => buildExchangeBody({ api_key: 'k', request_token: 'r' }),    /api_secret required/);
});

// ---------- extractRequestToken ----------

test('extractRequestToken returns the request_token param', () => {
  const url = 'https://ats.rajasekarselvam.com/api/v1/oauth/zerodha/callback?status=success&request_token=abc123';
  assert.equal(extractRequestToken(url), 'abc123');
});

test('extractRequestToken handles URLs without the param', () => {
  assert.equal(extractRequestToken('https://example.com/'), null);
  assert.equal(extractRequestToken('https://example.com/?status=success'), null);
});

test('extractRequestToken returns null for invalid input', () => {
  assert.equal(extractRequestToken(''), null);
  assert.equal(extractRequestToken(null), null);
  assert.equal(extractRequestToken(undefined), null);
  assert.equal(extractRequestToken('not a url at all'), null);
});

test('extractRequestToken handles multiple params + URL-encoded value', () => {
  const url = 'https://kite.zerodha.com/connect/finish?action=login&type=login&status=success'
    + '&request_token=encoded%2Bvalue%2F123&extra=x';
  // URLSearchParams.get returns the decoded value
  assert.equal(extractRequestToken(url), 'encoded+value/123');
});

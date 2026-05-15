const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  buildIpAllowlist, compileEntry, compileAllowlist, clientIp, ipv4ToInt,
} = require('../ip-allowlist');

// --- Mock req/res for middleware tests ---
function mkReq({ path = '/api/orders/place', method = 'POST', xRealIp, xff, remote = '127.0.0.1' } = {}) {
  return {
    path,
    method,
    headers: {
      ...(xRealIp ? { 'x-real-ip': xRealIp } : {}),
      ...(xff     ? { 'x-forwarded-for': xff } : {}),
    },
    socket: { remoteAddress: remote },
  };
}
function mkRes() {
  let status = 200, body = null;
  return {
    status(c) { status = c; return this; },
    json(o)   { body = o; return this; },
    get _status() { return status; },
    get _body()   { return body; },
  };
}

// --- ipv4ToInt ---
test('ipv4ToInt: parses valid IPs', () => {
  assert.equal(ipv4ToInt('0.0.0.0'), 0);
  assert.equal(ipv4ToInt('255.255.255.255'), 0xFFFFFFFF);
  assert.equal(ipv4ToInt('192.168.1.1'), (192 << 24 | 168 << 16 | 1 << 8 | 1) >>> 0);
});
test('ipv4ToInt: rejects garbage', () => {
  assert.equal(ipv4ToInt('not-an-ip'), null);
  assert.equal(ipv4ToInt('1.2.3'),     null);
  assert.equal(ipv4ToInt('1.2.3.300'), null);
});

// --- compileEntry / single IP ---
test('compileEntry: single IPv4 matches exactly', () => {
  const m = compileEntry('203.0.113.7');
  assert.equal(m('203.0.113.7'), true);
  assert.equal(m('203.0.113.8'), false);
});

test('compileEntry: single IPv6 string match', () => {
  const m = compileEntry('2001:db8::1');
  assert.equal(m('2001:db8::1'), true);
  assert.equal(m('2001:db8::2'), false);
});

// --- compileEntry / CIDR ---
test('compileEntry: /24 matches the 256-host network', () => {
  const m = compileEntry('203.0.113.0/24');
  assert.equal(m('203.0.113.0'),   true);
  assert.equal(m('203.0.113.99'),  true);
  assert.equal(m('203.0.113.255'), true);
  assert.equal(m('203.0.114.0'),   false);
  assert.equal(m('203.0.112.255'), false);
});

test('compileEntry: /32 matches a single host', () => {
  const m = compileEntry('198.51.100.5/32');
  assert.equal(m('198.51.100.5'), true);
  assert.equal(m('198.51.100.6'), false);
});

test('compileEntry: /0 matches everything', () => {
  const m = compileEntry('0.0.0.0/0');
  assert.equal(m('1.1.1.1'), true);
  assert.equal(m('8.8.8.8'), true);
});

test('compileEntry: invalid CIDR returns null', () => {
  assert.equal(compileEntry('not-an-ip/24'), null);
  assert.equal(compileEntry('1.2.3.4/40'),   null);
});

// --- compileAllowlist ---
test('compileAllowlist: parses multiple entries, drops blanks', () => {
  const ms = compileAllowlist('192.0.2.1, 203.0.113.0/24,, 198.51.100.5');
  assert.equal(ms.length, 3);
  assert.equal(ms[0].entry, '192.0.2.1');
  assert.equal(ms[1].entry, '203.0.113.0/24');
  assert.equal(ms[2].entry, '198.51.100.5');
});

// --- clientIp ---
test('clientIp: prefers x-real-ip', () => {
  assert.equal(clientIp(mkReq({ xRealIp: '5.5.5.5', xff: '6.6.6.6, 7.7.7.7' })), '5.5.5.5');
});
test('clientIp: falls back to first XFF token', () => {
  assert.equal(clientIp(mkReq({ xff: '5.5.5.5, 6.6.6.6' })), '5.5.5.5');
});
test('clientIp: falls back to socket remoteAddress, strips ::ffff: prefix', () => {
  assert.equal(clientIp(mkReq({ remote: '::ffff:1.2.3.4' })), '1.2.3.4');
});

// --- Middleware ---
test('middleware: disabled when whitelist empty -> always next()', () => {
  const mw = buildIpAllowlist({ whitelist: '' });
  let called = false;
  mw(mkReq({ xRealIp: '1.2.3.4' }), mkRes(), () => { called = true; });
  assert.equal(called, true);
});

test('middleware: allowed IP -> next()', () => {
  const mw = buildIpAllowlist({ whitelist: '203.0.113.0/24,198.51.100.5' });
  let called = false;
  mw(mkReq({ xRealIp: '203.0.113.42' }), mkRes(), () => { called = true; });
  assert.equal(called, true);
});

test('middleware: blocked IP -> 403 ip_not_allowlisted', () => {
  const mw = buildIpAllowlist({ whitelist: '203.0.113.0/24' });
  const res = mkRes();
  let called = false;
  mw(mkReq({ xRealIp: '8.8.8.8' }), res, () => { called = true; });
  assert.equal(called, false);
  assert.equal(res._status, 403);
  assert.equal(res._body.ok, false);
  assert.equal(res._body.reason, 'ip_not_allowlisted');
});

test('middleware: bypass paths (e.g. /api/health) always next() even when IP blocked', () => {
  const mw = buildIpAllowlist({ whitelist: '203.0.113.0/24' });
  let called = false;
  mw(mkReq({ path: '/api/health', xRealIp: '8.8.8.8' }), mkRes(), () => { called = true; });
  assert.equal(called, true);
});

test('middleware: Zerodha callback bypass works', () => {
  const mw = buildIpAllowlist({ whitelist: '203.0.113.0/24' });
  let called = false;
  mw(mkReq({ path: '/api/brokers/zerodha/callback', xRealIp: '52.114.7.99' }), mkRes(), () => { called = true; });
  assert.equal(called, true);
});

test('middleware: audit-only mode logs but lets request through', () => {
  const audited = [];
  const mw = buildIpAllowlist({
    whitelist: '203.0.113.0/24',
    mode: 'audit',
    audit: (event, data) => audited.push({ event, data }),
  });
  let called = false;
  mw(mkReq({ xRealIp: '8.8.8.8' }), mkRes(), () => { called = true; });
  assert.equal(called, true, 'audit mode should let the request through');
  assert.equal(audited.length, 1);
  assert.equal(audited[0].event, 'api.block.ip');
  assert.equal(audited[0].data.ip, '8.8.8.8');
  assert.equal(audited[0].data.mode, 'audit');
});

test('middleware: enforce mode also audits the block', () => {
  const audited = [];
  const mw = buildIpAllowlist({
    whitelist: '203.0.113.0/24',
    audit: (event, data) => audited.push({ event, data }),
  });
  mw(mkReq({ xRealIp: '8.8.8.8' }), mkRes(), () => {});
  assert.equal(audited.length, 1);
  assert.equal(audited[0].event, 'api.block.ip');
});

test('middleware: state() surfaces config', () => {
  const mw = buildIpAllowlist({ whitelist: '203.0.113.0/24,198.51.100.5', mode: 'audit' });
  const s = mw.state();
  assert.equal(s.enabled, true);
  assert.equal(s.enforcing, false);
  assert.equal(s.mode, 'audit');
  assert.deepEqual(s.entries, ['203.0.113.0/24', '198.51.100.5']);
});

test('middleware: state() shows disabled when no entries', () => {
  const mw = buildIpAllowlist({ whitelist: '' });
  const s = mw.state();
  assert.equal(s.enabled, false);
  assert.equal(s.enforcing, false);
});

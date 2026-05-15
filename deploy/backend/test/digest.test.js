const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Digest } = require('../digest');

const mkPaper = () => ({ stats: () => ({ cash: 1_000_000, totalEquity: 1_050_000, realizedPnl: 32_500, unrealizedPnl: 17_500, openPositions: 4 }) });
const mkPnl   = () => ({ recent: (n) => Array.from({ length: n }, (_, i) => ({ date: `2026-05-${15 - i}`, realizedPnl: 1000 * (n - i), unrealizedPnl: 500, equity: 1_000_000 + 1500 * (n - i) })) });
const mkWorm  = () => ({ root: () => ({ count: 612, headSeq: 612, merkleRoot: 'a'.repeat(64), headHash: 'b'.repeat(64) }) });
const mkAutorun = () => ({ state: () => ({ history: [
  { ts: '2026-05-15T09:30:00Z', strategy: 'rsi', symbol: 'RELIANCE', signal: 'BUY', action: 'placed' },
  { ts: '2026-05-15T10:30:00Z', strategy: 'rsi', symbol: 'RELIANCE', signal: 'HOLD', action: 'noop' },
] }) });

test('build daily includes paper stats + cash + equity', () => {
  const d = new Digest({ paper: mkPaper(), pnl: mkPnl(), wormAudit: mkWorm(), autorun: mkAutorun() });
  const out = d.build({ kind: 'daily' });
  assert.ok(out.subject.startsWith('ATS daily digest'));
  assert.ok(out.html.includes('₹10,00,000') || out.html.includes('₹1,000,000'), 'cash');
  assert.ok(out.html.includes('₹10,50,000') || out.html.includes('₹1,050,000'), 'equity');
  assert.ok(out.html.includes('Open positions'), 'positions section');
});

test('build weekly pulls 7-day pnl rows', () => {
  const d = new Digest({ paper: mkPaper(), pnl: mkPnl() });
  const out = d.build({ kind: 'weekly' });
  assert.ok(out.subject.includes('weekly'));
  // weekly should request 7 rows -> table should appear
  assert.ok(out.html.includes('last 7 days'), 'weekly rows label');
});

test('escapes HTML in news titles', () => {
  const news = { top: () => [{ title: '<script>alert(1)</script>', link: 'http://x', source: 'evil' }] };
  const d = new Digest({ paper: mkPaper(), news });
  const out = d.build({ kind: 'daily' });
  assert.ok(!out.html.includes('<script>alert(1)</script>'));
  assert.ok(out.html.includes('&lt;script&gt;'));
});

test('text fallback contains subject + key numbers', () => {
  const d = new Digest({ paper: mkPaper(), wormAudit: mkWorm() });
  const out = d.build({ kind: 'daily' });
  assert.ok(out.text.includes('ATS daily digest'));
  assert.ok(out.text.includes('cash='));
  assert.ok(out.text.includes('WORM:'));
});

test('send fails cleanly when emailAlerts missing', async () => {
  const d = new Digest({ paper: mkPaper() });
  const r = await d.send({ to: 'x@y.com', kind: 'daily' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /emailAlerts/);
});

test('send fails when no recipient anywhere', async () => {
  // Clear env to avoid picking up real DIGEST_TO
  const prev = process.env.DIGEST_TO; delete process.env.DIGEST_TO;
  const d = new Digest({ paper: mkPaper(), emailAlerts: { send: async () => ({ ok: true }) } });
  const r = await d.send({ kind: 'daily' });
  assert.equal(r.ok, false);
  assert.match(r.reason, /no recipient/);
  if (prev != null) process.env.DIGEST_TO = prev;
});

test('send calls emailAlerts.send with subject + html + text', async () => {
  let captured = null;
  const ea = { send: async (m) => { captured = m; return { ok: true, id: 'msg-123' }; } };
  const d = new Digest({ paper: mkPaper(), emailAlerts: ea });
  const r = await d.send({ to: 'me@test.com', kind: 'daily' });
  assert.equal(r.ok, true);
  assert.equal(captured.to, 'me@test.com');
  assert.ok(captured.subject.includes('ATS daily digest'));
  assert.ok(captured.html.length > 100);
  assert.ok(captured.text.length > 20);
});

test('audit hook fires on send', async () => {
  const events = [];
  const ea = { send: async () => ({ ok: true }) };
  const d = new Digest({ paper: mkPaper(), emailAlerts: ea, audit: (e, x) => events.push({ e, x }) });
  await d.send({ to: 'x@y.com', kind: 'weekly' });
  assert.ok(events.some(ev => ev.e === 'digest.sent'));
  assert.equal(events[0].x.kind, 'weekly');
});

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TwoFactor, istDayKey } = require('../two-factor');

function mockTg() {
  const sent = [];
  return {
    sent,
    post: async (text) => { sent.push(text); return { sent: true }; },
  };
}

test('istDayKey: returns YYYY-MM-DD in IST', () => {
  // 2026-05-15 19:30 UTC = 2026-05-16 01:00 IST
  const k = istDayKey(new Date('2026-05-15T19:30:00Z').getTime());
  assert.equal(k, '2026-05-16');
  // 2026-05-15 12:00 UTC = 2026-05-15 17:30 IST
  assert.equal(istDayKey(new Date('2026-05-15T12:00:00Z').getTime()), '2026-05-15');
});

test('shouldChallenge: false when no Telegram configured', () => {
  const tf = new TwoFactor();
  assert.equal(tf.shouldChallenge({ userId: 'U1', strategyTag: 'S' }), false);
});

test('shouldChallenge: true when Telegram + fresh day + pair', () => {
  const tg = mockTg();
  const tf = new TwoFactor({ postTelegram: tg.post });
  assert.equal(tf.shouldChallenge({ userId: 'U1', strategyTag: 'S' }), true);
});

test('shouldChallenge: false when explicit disabled', () => {
  const tg = mockTg();
  const tf = new TwoFactor({ postTelegram: tg.post, disabled: true });
  assert.equal(tf.shouldChallenge({ userId: 'U1', strategyTag: 'S' }), false);
});

test('issue: produces a token, sends Telegram with payload summary', async () => {
  const tg = mockTg();
  const tf = new TwoFactor({ postTelegram: tg.post, baseUrl: 'https://example.com' });
  const r = await tf.issue({
    userId: 'U1',
    strategyTag: 'momentum-v2',
    payload: { symbol: 'RELIANCE', side: 'BUY', quantity: 50, product: 'BO', orderType: 'LIMIT', price: 2950, algoId: 'ALGO-001' },
  });
  assert.equal(typeof r.token, 'string');
  assert.equal(r.token.length, 32);
  assert.equal(r.sent, true);
  // Telegram message must include the confirm URL with the token + the symbol
  assert.equal(tg.sent.length, 1);
  assert.ok(tg.sent[0].includes(`https://example.com/api/orders/confirm-2fa/${r.token}`),
    'confirm URL missing in message');
  assert.ok(tg.sent[0].includes('RELIANCE'),  'symbol missing');
  assert.ok(tg.sent[0].includes('momentum-v2'), 'strategy missing');
  assert.ok(tg.sent[0].includes('ALGO-001'),  'algoId missing');
});

test('consume: valid token returns payload, marks pair confirmed', async () => {
  const tg = mockTg();
  const tf = new TwoFactor({ postTelegram: tg.post });
  const r = await tf.issue({ userId: 'U1', strategyTag: 'S', payload: { symbol: 'X' } });

  // First consume succeeds
  const c1 = tf.consume(r.token);
  assert.equal(c1.ok, true);
  assert.equal(c1.payload.symbol, 'X');
  // Now today's {U1,S} pair should be marked confirmed -> shouldChallenge=false
  assert.equal(tf.shouldChallenge({ userId: 'U1', strategyTag: 'S' }), false);
  // Different strategy still needs to challenge
  assert.equal(tf.shouldChallenge({ userId: 'U1', strategyTag: 'OTHER' }), true);
});

test('consume: token reuse fails', async () => {
  const tf = new TwoFactor({ postTelegram: mockTg().post });
  const r = await tf.issue({ userId: 'U1', strategyTag: 'S', payload: {} });
  assert.equal(tf.consume(r.token).ok, true);
  const c2 = tf.consume(r.token);
  assert.equal(c2.ok, false);
  assert.equal(c2.reason, 'unknown_or_used');
});

test('consume: unknown token fails', () => {
  const tf = new TwoFactor({ postTelegram: mockTg().post });
  const c = tf.consume('not-a-real-token');
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'unknown_or_used');
});

test('consume: expired token returns expired', async () => {
  const tf = new TwoFactor({ postTelegram: mockTg().post, ttlMs: 1 });   // 1ms TTL
  const r = await tf.issue({ userId: 'U1', strategyTag: 'S', payload: {} });
  await new Promise(res => setTimeout(res, 10));   // wait past TTL
  const c = tf.consume(r.token);
  assert.equal(c.ok, false);
  assert.equal(c.reason, 'expired');
});

test('audit hook fires on issue, consume, expiration', async () => {
  const events = [];
  const tf = new TwoFactor({
    postTelegram: mockTg().post,
    audit: (event, data) => events.push({ event, data }),
    ttlMs: 1,
  });
  const r = await tf.issue({ userId: 'U1', strategyTag: 'S', payload: { symbol: 'X' } });
  await new Promise(res => setTimeout(res, 10));
  tf.consume(r.token);

  const types = events.map(e => e.event);
  assert.ok(types.includes('order.2fa.issued'), 'missing issued audit');
  assert.ok(types.includes('order.2fa.expired'), 'missing expired audit (token was past TTL)');
});

test('audit hook records successful confirm path', async () => {
  const events = [];
  const tf = new TwoFactor({
    postTelegram: mockTg().post,
    audit: (event, data) => events.push({ event, data }),
  });
  const r = await tf.issue({ userId: 'U1', strategyTag: 'S', payload: { symbol: 'X' } });
  tf.consume(r.token);
  assert.ok(events.some(e => e.event === 'order.2fa.confirmed'),
    'missing confirmed audit');
});

test('stats: surfaces pending + confirmed counts', async () => {
  const tf = new TwoFactor({ postTelegram: mockTg().post });
  await tf.issue({ userId: 'U1', strategyTag: 'S', payload: {} });
  await tf.issue({ userId: 'U2', strategyTag: 'T', payload: {} });
  const s1 = tf.stats();
  assert.equal(s1.pendingCount, 2);
  assert.equal(s1.confirmedTodayCount, 0);
  assert.equal(s1.hasTelegram, true);
});

test('markConfirmed: bypasses shouldChallenge without an issue/consume cycle', () => {
  const tf = new TwoFactor({ postTelegram: mockTg().post });
  tf.markConfirmed({ userId: 'U1', strategyTag: 'S' });
  assert.equal(tf.shouldChallenge({ userId: 'U1', strategyTag: 'S' }), false);
});

test('telegram fail does not break issue (token still produced)', async () => {
  const tf = new TwoFactor({ postTelegram: async () => { throw new Error('telegram down'); } });
  const r = await tf.issue({ userId: 'U1', strategyTag: 'S', payload: {} });
  assert.equal(typeof r.token, 'string');
  assert.equal(r.sent, false);
});

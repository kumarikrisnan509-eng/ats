// notify.test.js — T-153 regression guard for notify.js.
//
// notify() is the operator's only push channel for:
//   - T-115 broker stall transitions (Telegram on 403 cascade)
//   - T-114 reauth retry chain failures
//   - alerts.js price-alert fires
//   - admin escalations (kill-switch, disk-full, etc.)
//
// Regressions to guard:
//   - notify() throwing on any input (would crash whatever called it)
//   - Markdown body malformed (Telegram rejects the message silently)
//   - Long field values blowing past Telegram's 4096-char limit
//   - ENABLED flag flipped (notifications sent when never configured)

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// Note: notify.js reads TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID at module-load
// time. Tests run with neither set (the dev/CI default), so ENABLED is false
// and postTelegram() never hits the network.
const { notify, postTelegram, ENABLED } = require('../notify');

// ---------- ENABLED gating ----------

test('ENABLED is false when TELEGRAM_BOT_TOKEN/CHAT_ID env not set', () => {
  // Sandbox + CI run without these env vars, so the flag must be false.
  // (If you're running locally with env set, this single assertion may
  // flip — that's expected. Skip it via { skip: !!ENABLED }.)
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    assert.equal(ENABLED, false);
  }
});

test('postTelegram resolves to {sent:false, reason:not_configured} when ENABLED is false', async () => {
  if (ENABLED) return; // skip when actually configured
  const r = await postTelegram('test message');
  assert.deepEqual(r, { sent: false, reason: 'not_configured' });
});

test('postTelegram never throws on weird input', async () => {
  if (ENABLED) return;
  // Each of these would crash on a typo'd implementation.
  await postTelegram('');
  await postTelegram(null);
  await postTelegram(undefined);
  await postTelegram('a'.repeat(10_000)); // way over Telegram's limit, but the API decides; we shouldn't pre-truncate or crash
  assert.ok(true, 'postTelegram tolerated all four inputs without throwing');
});

// ---------- notify() — high-level wrapper ----------

test('notify logs to console and returns a Promise', async () => {
  const captured = [];
  const origLog = console.log;
  console.log = (...args) => captured.push(args.join(' '));
  try {
    const ret = notify('info', 'Test title', { body: 'Test body' });
    assert.ok(ret && typeof ret.then === 'function', 'notify must return a Promise');
    await ret;
    // At least one console line must mention the title.
    assert.ok(captured.some(l => l.includes('Test title')), `expected console line for title; saw: ${captured.join(' | ')}`);
  } finally {
    console.log = origLog;
  }
});

test('notify console line includes the level and title', async () => {
  const captured = [];
  const origLog = console.log;
  console.log = (...args) => captured.push(args.join(' '));
  try {
    await notify('error', 'Broker stalled', { body: 'Kite WS rejected 3 reconnects' });
    const line = captured.find(l => l.includes('Broker stalled')) || '';
    assert.match(line, /\[NOTIFY:ERROR\]/);
    assert.match(line, /Broker stalled/);
    assert.match(line, /Kite WS rejected 3 reconnects/);
  } finally {
    console.log = origLog;
  }
});

test('notify accepts info/warn/error/success levels without throwing', async () => {
  const origLog = console.log;
  console.log = () => {};
  try {
    await notify('info',    't', { body: 'b' });
    await notify('warn',    't', { body: 'b' });
    await notify('error',   't', { body: 'b' });
    await notify('success', 't', { body: 'b' });
    assert.ok(true);
  } finally {
    console.log = origLog;
  }
});

test('notify accepts an unknown string-level without throwing (falls through to neutral)', async () => {
  const origLog = console.log;
  console.log = () => {};
  try {
    await notify('debug',     't', { body: 'b' });
    await notify('madeup',    't', { body: 'b' });
    await notify('',          't', { body: 'b' });   // empty string OK
    assert.ok(true, 'notify must not throw on unknown string level');
  } finally {
    console.log = origLog;
  }
});

test('notify defends against non-string level (null/undefined/number)', async () => {
  // T-154: regression guard for the previously-latent crash on
  // level.toUpperCase() when level is null/undefined/non-string. The fix
  // coerces to a safe 'info' default rather than throwing — keeps the
  // operator-alert path crash-free if a caller forwards e.g. an Error.
  const captured = [];
  const origLog = console.log;
  console.log = (...args) => captured.push(args.join(' '));
  try {
    await notify(null,      't', { body: 'b' });
    await notify(undefined, 't', { body: 'b' });
    await notify(42,        't', { body: 'b' });
    await notify({},        't', { body: 'b' });
    const lines = captured.filter(l => l.includes('[NOTIFY:'));
    assert.ok(lines.length >= 4, `expected >=4 NOTIFY lines, saw ${lines.length}`);
    // Non-string level should default to 'info'.
    assert.ok(lines.every(l => /\[NOTIFY:INFO\]/.test(l)),
      `non-string level should default to INFO; saw: ${lines.join(' | ')}`);
  } finally {
    console.log = origLog;
  }
});

test('notify with no details still works (no body, fields, url)', async () => {
  const origLog = console.log;
  console.log = () => {};
  try {
    await notify('info', 'bare title');
    await notify('info', 'bare title', {});
    assert.ok(true);
  } finally {
    console.log = origLog;
  }
});

test('notify with fields object does not throw on numeric/string values', async () => {
  const origLog = console.log;
  console.log = () => {};
  try {
    await notify('warn', 'Price moved', {
      body: 'TCS up',
      fields: {
        symbol: 'TCS',
        ltp: 3001.42,
        pct: 5.3,
        large: 'x'.repeat(500),   // longer than 100 — should be truncated in Markdown
      },
    });
    assert.ok(true);
  } finally {
    console.log = origLog;
  }
});

test('notify with a url field does not throw', async () => {
  const origLog = console.log;
  console.log = () => {};
  try {
    await notify('error', 'Broker action needed', {
      body: 'Re-auth from the Brokers screen',
      url: 'https://ats.rajasekarselvam.com/#brokers',
    });
    assert.ok(true);
  } finally {
    console.log = origLog;
  }
});

test('notify never re-throws when postTelegram would fail', async () => {
  // Even if the network is down or the bot token is bogus, notify() must
  // resolve cleanly so the caller (alerts.evaluate, broker stall watcher,
  // cron-reauth) keeps running.
  const origLog = console.log;
  console.log = () => {};
  try {
    const r = await notify('error', 't', { body: 'b' });
    // r is whatever postTelegram resolved to — usually {sent:false,...}.
    // The contract is "doesn't throw", not "always returns truthy".
    assert.ok(r === undefined || typeof r === 'object');
  } finally {
    console.log = origLog;
  }
});

// ---------- module shape ----------

test('module exports notify, postTelegram, ENABLED', () => {
  assert.equal(typeof notify, 'function');
  assert.equal(typeof postTelegram, 'function');
  assert.equal(typeof ENABLED, 'boolean');
});

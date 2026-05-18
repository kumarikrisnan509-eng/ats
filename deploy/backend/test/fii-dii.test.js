// fii-dii.test.js — T-157 regression guard for fii-dii.js (E7).
//
// FiiDii tracks daily FII/FPI + DII cash market activity from NSE. The data
// feeds Dashboard sentiment context and AI-critic prompts. A regression that
// flips category mapping (calls FII a DII or vice-versa) silently misleads
// every consumer about who's buying vs selling.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FiiDii } = require('../fii-dii');

// ---------- fixture: mock NSE response ----------
function mockNseResponse(rows) {
  // Returns a fetchImpl that yields a Response-like object with .ok and .json().
  return async () => ({
    ok: true,
    json: async () => rows,
  });
}

// ---------- status ----------

test('status() reports ready:false before any refresh', () => {
  const f = new FiiDii({ fetchImpl: async () => ({ ok: false }) });
  assert.deepEqual(f.status(), { ready: false });
});

// ---------- refresh + today ----------

test('refresh: normalizes FII + DII rows and maps category correctly', async () => {
  const f = new FiiDii({ fetchImpl: mockNseResponse([
    { category: 'FII/FPI *', date: '18-May-2026', buyValue: 12000, sellValue: 11000, netValue: 1000 },
    { category: 'DII **',     date: '18-May-2026', buyValue: 9000,  sellValue: 9500,  netValue: -500 },
  ]) });
  const today = await f.today();
  assert.ok(today);
  assert.ok(today.fii);
  assert.ok(today.dii);
  assert.equal(today.fii.category, 'FII');
  assert.equal(today.dii.category, 'DII');
  assert.equal(today.fii.net_cr, 1000);
  assert.equal(today.dii.net_cr, -500);
  assert.equal(today.fii.buy_cr, 12000);
  assert.equal(today.fii.sell_cr, 11000);
  assert.equal(today.net_total_cr, 500);  // 1000 + (-500)
  assert.equal(today.date_iso, '2026-05-18');
});

test('refresh: handles a row with category "FPI" as FII', async () => {
  // The mapper regex is /FII|FPI/i — FPI alone should still classify as FII.
  const f = new FiiDii({ fetchImpl: mockNseResponse([
    { category: 'FPI', date: '18-May-2026', buyValue: 100, sellValue: 50, netValue: 50 },
  ]) });
  const t = await f.today();
  assert.ok(t.fii);
  assert.equal(t.fii.net_cr, 50);
});

test('refresh: numeric coercion handles string values', async () => {
  // NSE sometimes returns numbers as strings; Number() coercion must handle it.
  const f = new FiiDii({ fetchImpl: mockNseResponse([
    { category: 'FII', date: '18-May-2026', buyValue: '1500.50', sellValue: '1200.25', netValue: '300.25' },
  ]) });
  const t = await f.today();
  assert.equal(t.fii.buy_cr, 1500.50);
  assert.equal(t.fii.sell_cr, 1200.25);
  assert.equal(t.fii.net_cr, 300.25);
});

test('refresh: handles missing or unparseable dates by falling back to current date', async () => {
  const f = new FiiDii({ fetchImpl: mockNseResponse([
    { category: 'FII', date: 'malformed', buyValue: 100, sellValue: 50, netValue: 50 },
  ]) });
  const t = await f.today();
  assert.ok(t.fii);
  // Falls back to today's ISO date.
  assert.match(t.date_iso, /^\d{4}-\d{2}-\d{2}$/);
});

// ---------- error paths ----------

test('refresh: HTTP non-ok response throws (and is caught by _getFresh)', async () => {
  const f = new FiiDii({ fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  // _getFresh catches the throw and seeds an empty cache.
  const t = await f.today();
  assert.equal(t, null);
});

test('refresh: non-array response throws (caught by _getFresh)', async () => {
  const f = new FiiDii({ fetchImpl: async () => ({
    ok: true,
    json: async () => ({ error: 'maintenance' }),
  }) });
  const t = await f.today();
  // _getFresh caught the throw; cache stays empty.
  assert.equal(t, null);
});

test('today() returns null when fetch throws', async () => {
  const f = new FiiDii({ fetchImpl: async () => { throw new Error('econnreset'); } });
  const t = await f.today();
  assert.equal(t, null);
});

// ---------- history ----------

test('snapshot(): exposes today + history + ts', async () => {
  const f = new FiiDii({ fetchImpl: mockNseResponse([
    { category: 'FII', date: '18-May-2026', buyValue: 100, sellValue: 50, netValue: 50 },
    { category: 'DII', date: '18-May-2026', buyValue: 200, sellValue: 100, netValue: 100 },
  ]) });
  const s = await f.snapshot();
  assert.ok(s.today);
  assert.ok(Array.isArray(s.history));
  assert.equal(s.history.length, 1);
  assert.equal(s.history[0].fii_net_cr, 50);
  assert.equal(s.history[0].dii_net_cr, 100);
  assert.match(s.ts, /^\d{4}-\d{2}-\d{2}T/);
});

test('history: same-day repeated refresh does not append duplicates', async () => {
  const f = new FiiDii({ fetchImpl: mockNseResponse([
    { category: 'FII', date: '18-May-2026', buyValue: 100, sellValue: 50, netValue: 50 },
  ]) });
  // Force-bypass the 30min TTL by direct refresh() calls.
  await f.refresh();
  await f.refresh();
  await f.refresh();
  const s = await f.snapshot();
  assert.equal(s.history.length, 1, 'same-day refreshes must not produce duplicate history rows');
});

// ---------- status after refresh ----------

test('status() reports ready:true + counts after refresh', async () => {
  const f = new FiiDii({ fetchImpl: mockNseResponse([
    { category: 'FII', date: '18-May-2026', buyValue: 100, sellValue: 50, netValue: 50 },
    { category: 'DII', date: '18-May-2026', buyValue: 200, sellValue: 100, netValue: 100 },
  ]) });
  await f.refresh();
  const st = f.status();
  assert.equal(st.ready, true);
  assert.equal(st.lastDate, '2026-05-18');
  assert.equal(st.historyDays, 1);
});

// ---------- module shape ----------

test('module exports FiiDii class', () => {
  assert.equal(typeof FiiDii, 'function');
});

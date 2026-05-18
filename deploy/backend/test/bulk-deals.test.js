// bulk-deals.test.js — T-157 regression guard for bulk-deals.js (T-121).
//
// BulkDeals feeds the Dashboard's "Bulk / Block Deals" card and provides
// per-symbol context to /critique-rich AI prompts. A regression that flips
// the buy/sell side, or fails to sort by INR value, silently misleads the
// AI critic about who's accumulating vs distributing a name.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { BulkDeals } = require('../bulk-deals');

// ---------- fixtures ----------
function seeded(cache) {
  const b = new BulkDeals({ fetchImpl: async () => ({ ok: false }) });
  b._cache = {
    ts: Date.now(),
    fetchedMs: 5,
    as_on_date: '18-May-2026',
    bulk: cache.bulk || [],
    block: cache.block || [],
    short: cache.short || [],
    bySymbol: new Map(),
    ...cache,
  };
  // Re-index bySymbol
  b._cache.bySymbol = new Map();
  for (const d of [...(cache.bulk || []), ...(cache.block || [])]) {
    if (!b._cache.bySymbol.has(d.symbol)) b._cache.bySymbol.set(d.symbol, []);
    b._cache.bySymbol.get(d.symbol).push(d);
  }
  return b;
}

// ---------- status ----------

test('status() reports ready:false before cache warms', () => {
  const b = new BulkDeals({ fetchImpl: async () => ({}) });
  assert.deepEqual(b.status(), { ready: false });
});

test('status() reports ready + bucket counts after seed', () => {
  const b = seeded({
    bulk:  [{ symbol: 'TCS', kind: 'bulk',  qty: 1000, watp: 3000, inr_value: 3000000 }],
    block: [{ symbol: 'INFY', kind: 'block', qty: 500, watp: 1500, inr_value: 750000 }],
    short: [{ symbol: 'WIPRO', kind: 'short', qty: 100, watp: 400 }],
  });
  const s = b.status();
  assert.equal(s.ready, true);
  assert.equal(s.bulk, 1);
  assert.equal(s.block, 1);
  assert.equal(s.short, 1);
  assert.equal(s.asOn, '18-May-2026');
});

// ---------- today() ----------

test('today() returns bulk + block by default; short empty unless includeShort:true', async () => {
  const b = seeded({
    bulk:  [{ symbol: 'TCS', kind: 'bulk', qty: 1000, watp: 3000, inr_value: 3000000 }],
    block: [{ symbol: 'INFY', kind: 'block', qty: 500, watp: 1500, inr_value: 750000 }],
    short: [{ symbol: 'WIPRO', kind: 'short', qty: 100, watp: 400 }],
  });
  const t1 = await b.today();
  assert.equal(t1.bulk.length, 1);
  assert.equal(t1.block.length, 1);
  assert.deepEqual(t1.short, []);

  const t2 = await b.today({ includeShort: true });
  assert.equal(t2.short.length, 1);
});

test('today() respects limit param', async () => {
  const big = [];
  for (let i = 0; i < 100; i++) {
    big.push({ symbol: `SYM${i}`, kind: 'bulk', qty: 100, watp: 100, inr_value: 10000 });
  }
  const b = seeded({ bulk: big });
  const t = await b.today({ limit: 5 });
  assert.equal(t.bulk.length, 5);
});

test('today() returns as_on_date from cache', async () => {
  const b = seeded({ bulk: [] });
  const t = await b.today();
  assert.equal(t.as_on_date, '18-May-2026');
});

// ---------- forSymbol() ----------

test('forSymbol() returns deals indexed by symbol', async () => {
  const b = seeded({
    bulk:  [{ symbol: 'TCS', kind: 'bulk',  qty: 1000, watp: 3000, inr_value: 3000000 }],
    block: [{ symbol: 'TCS', kind: 'block', qty: 500, watp: 3010,  inr_value: 1505000 }],
  });
  const r = await b.forSymbol('TCS');
  assert.equal(r.length, 2);
  assert.ok(r.some(x => x.kind === 'bulk'));
  assert.ok(r.some(x => x.kind === 'block'));
});

test('forSymbol() returns [] for symbol not in cache', async () => {
  const b = seeded({ bulk: [{ symbol: 'TCS', qty: 1, watp: 1 }] });
  const r = await b.forSymbol('NONEXISTENT');
  assert.deepEqual(r, []);
});

test('forSymbol() is case-insensitive + whitespace-tolerant', async () => {
  const b = seeded({ bulk: [{ symbol: 'TCS', kind: 'bulk', qty: 1, watp: 1 }] });
  assert.equal((await b.forSymbol('tcs')).length, 1);
  assert.equal((await b.forSymbol(' TCS ')).length, 1);
});

test('forSymbol() returns [] for empty/null/undefined', async () => {
  const b = seeded({ bulk: [{ symbol: 'TCS', kind: 'bulk', qty: 1, watp: 1 }] });
  assert.deepEqual(await b.forSymbol(''), []);
  assert.deepEqual(await b.forSymbol(null), []);
  assert.deepEqual(await b.forSymbol(undefined), []);
});

// ---------- module shape ----------

test('module exports BulkDeals class', () => {
  assert.equal(typeof BulkDeals, 'function');
});

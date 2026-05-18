// market-meta.test.js — T-149 regression guard for market-meta.js (Tier 71).
//
// market-meta is the holidays cache layer that decides whether ATS treats
// today as a trading day. Consumed by:
//   - Frontend Dashboard market-status banner
//   - Scanner gate (don't scan on holidays)
//   - Paper-order placement (block on holidays)
//   - Promote-check (already-quiet days don't count toward win-rate)
//
// A regression in the fallback chain — e.g. always returning static seed
// even after refreshFromBroker() succeeds — silently makes ATS treat Diwali
// as a trading day for the rest of the year.
//
// Uses an in-memory better-sqlite3 (':memory:'). Skips gracefully if the
// native binding isn't built (sandbox-only condition; CI builds it).

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

let Database;
try {
  Database = require('better-sqlite3');
} catch (_) {
  // Native binding missing — node:test will report 'tests skipped'.
  Database = null;
}

const { createMarketMeta, STATIC_FALLBACK_HOLIDAYS } = require('../market-meta');

// ---------- fixtures ----------
function freshDb() {
  if (!Database) return null;
  const conn = new Database(':memory:');
  return { _conn: conn };
}

function fakeBroker({ holidaysResponse, throwOn = null } = {}) {
  return {
    kc: {
      getHolidays: async () => {
        if (throwOn === 'getHolidays') throw new Error('kite api blew up');
        return holidaysResponse;
      },
    },
  };
}

// ---------- module exports ----------

test('exports createMarketMeta + STATIC_FALLBACK_HOLIDAYS', () => {
  assert.equal(typeof createMarketMeta, 'function');
  assert.ok(Array.isArray(STATIC_FALLBACK_HOLIDAYS));
  assert.ok(STATIC_FALLBACK_HOLIDAYS.length > 0);
  for (const h of STATIC_FALLBACK_HOLIDAYS) {
    assert.match(h.date, /^\d{4}-\d{2}-\d{2}$/, 'fallback holiday date must be YYYY-MM-DD');
    assert.ok(typeof h.name === 'string' && h.name.length > 0);
  }
});

// ---------- DB-backed tests ----------

test('getHolidays returns static fallback when cache empty', { skip: !Database }, () => {
  const db = freshDb();
  const mm = createMarketMeta({ db, broker: null });
  const r = mm.getHolidays();
  assert.equal(r.source, 'static_fallback');
  assert.deepEqual(r.holidays, STATIC_FALLBACK_HOLIDAYS);
  assert.equal(r.fetchedAt, null);
});

test('refreshFromBroker writes to cache; getHolidays returns cached after', { skip: !Database }, async () => {
  const db = freshDb();
  const broker = fakeBroker({
    holidaysResponse: [
      { date: '2026-03-29', name: 'Holi', exchange: 'NSE' },
      { date: '2026-04-14', name: 'Ambedkar Jayanti' },
    ],
  });
  const mm = createMarketMeta({ db, broker });

  const refresh = await mm.refreshFromBroker();
  assert.equal(refresh.ok, true);
  assert.equal(refresh.count, 2);

  const r = mm.getHolidays();
  assert.equal(r.source, 'kite_api');
  assert.equal(r.holidays.length, 2);
  assert.deepEqual(r.holidays[0], { date: '2026-03-29', name: 'Holi', type: 'NSE' });
  assert.deepEqual(r.holidays[1], { date: '2026-04-14', name: 'Ambedkar Jayanti', type: 'NSE' });
  assert.ok(r.fetchedAt, 'fetchedAt must be set after refresh');
});

test('refreshFromBroker normalizes Date instances to YYYY-MM-DD', { skip: !Database }, async () => {
  const db = freshDb();
  const broker = fakeBroker({
    holidaysResponse: [
      { date: new Date(Date.UTC(2026, 11, 25)), name: 'Christmas' },
    ],
  });
  const mm = createMarketMeta({ db, broker });
  await mm.refreshFromBroker();
  const r = mm.getHolidays();
  assert.equal(r.holidays[0].date, '2026-12-25');
});

test('refreshFromBroker drops rows with missing date', { skip: !Database }, async () => {
  const db = freshDb();
  const broker = fakeBroker({
    holidaysResponse: [
      { date: '2026-01-26', name: 'Republic Day' },
      { name: 'no-date row' },             // dropped
      { date: null, name: 'null-date row' }, // dropped
      { date: '2026-08-15', name: 'Independence Day' },
    ],
  });
  const mm = createMarketMeta({ db, broker });
  const r = await mm.refreshFromBroker();
  assert.equal(r.ok, true);
  assert.equal(r.count, 2);
  const h = mm.getHolidays().holidays;
  assert.equal(h.length, 2);
});

test('refreshFromBroker — broker without kc returns broker_unavailable', { skip: !Database }, async () => {
  const db = freshDb();
  const mm = createMarketMeta({ db, broker: null });
  const r = await mm.refreshFromBroker();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'broker_unavailable');
});

test('refreshFromBroker — broker.kc.getHolidays returns [] → no_data_from_broker', { skip: !Database }, async () => {
  const db = freshDb();
  const broker = fakeBroker({ holidaysResponse: [] });
  const mm = createMarketMeta({ db, broker });
  const r = await mm.refreshFromBroker();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_data_from_broker');
});

test('refreshFromBroker — broker.kc.getHolidays returns non-array → no_data_from_broker', { skip: !Database }, async () => {
  const db = freshDb();
  const broker = fakeBroker({ holidaysResponse: { error: 'permission_denied' } });
  const mm = createMarketMeta({ db, broker });
  const r = await mm.refreshFromBroker();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_data_from_broker');
});

test('refreshFromBroker — kc.getHolidays throws → fetch_failed with detail', { skip: !Database }, async () => {
  const db = freshDb();
  const broker = fakeBroker({ throwOn: 'getHolidays' });
  const mm = createMarketMeta({ db, broker });
  const r = await mm.refreshFromBroker();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'fetch_failed');
  assert.match(r.detail, /kite api blew up/);
});

test('refreshFromBroker — broker without getHolidays method falls through to no_data', { skip: !Database }, async () => {
  const db = freshDb();
  const broker = { kc: {} };   // no getHolidays
  const mm = createMarketMeta({ db, broker });
  const r = await mm.refreshFromBroker();
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'no_data_from_broker');
});

test('subsequent refreshes overwrite cache (REPLACE behavior)', { skip: !Database }, async () => {
  const db = freshDb();
  const broker1 = fakeBroker({
    holidaysResponse: [{ date: '2026-01-26', name: 'Republic Day' }],
  });
  const mm1 = createMarketMeta({ db, broker: broker1 });
  await mm1.refreshFromBroker();
  assert.equal(mm1.getHolidays().holidays.length, 1);

  // Second refresh with different data
  const broker2 = fakeBroker({
    holidaysResponse: [
      { date: '2026-03-29', name: 'Holi' },
      { date: '2026-04-14', name: 'Ambedkar' },
      { date: '2026-08-15', name: 'Independence' },
    ],
  });
  const mm2 = createMarketMeta({ db, broker: broker2 });
  await mm2.refreshFromBroker();
  const h = mm2.getHolidays().holidays;
  assert.equal(h.length, 3, 'second refresh must overwrite, not append');
});

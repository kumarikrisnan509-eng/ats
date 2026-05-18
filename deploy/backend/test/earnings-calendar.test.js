// earnings-calendar.test.js — T-143 regression guard for T-125 / T-126.
//
// The scanner's E3 gate (T-125) and the promote-check gate (T-126) both
// call EarningsCalendar.inResultsBlackout() to decide whether to suppress
// signals for symbols near a quarterly/annual results announcement.
//
// A regression that flips the polarity (returns null when in blackout, or
// vice-versa) silently lets the scanner emit signals during earnings
// announcements — exactly when ATS is supposed to stand down.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { EarningsCalendar, parseNseDate, categorise } = require('../earnings-calendar');

// ---------- helpers ----------
function todayPlus(days) {
  // parseNseDate only handles NSE's DD-Mon-YYYY format (e.g. '18-May-2026').
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const dd = String(d.getUTCDate()).padStart(2, '0');
  const mon = months[d.getUTCMonth()];
  return `${dd}-${mon}-${d.getUTCFullYear()}`;
}

// inResultsBlackout computes daysUntil as round((eventMs - now) / 86400000).
// parseNseDate returns midnight UTC of the day, so when 'now' is e.g. noon
// UTC, todayPlus(2) is only 36h away → rounds to daysUntil=1, not 2. The
// tests below want time-of-day-independent assertions; use a tolerance.
function nearby(actualDaysUntil, expectedDays) {
  // Accept ±1 day to absorb the noon-UTC rounding boundary.
  return Math.abs(actualDaysUntil - expectedDays) <= 1;
}

function buildCal(events) {
  // Pass a no-op fetchImpl so we never hit nseindia.com from CI.
  const cal = new EarningsCalendar({ fetchImpl: async () => ({ ok: false }) });
  // Seed the cache directly — we don't want to hit the network in tests.
  cal._cache = {
    events,
    ts: Date.now(),
    fetchedMs: 5,
  };
  return cal;
}

// ---------- tests ----------
test('inResultsBlackout returns null when cache not warmed', () => {
  const cal = new EarningsCalendar({ fetchImpl: async () => ({ ok: false }) });
  // _cache not seeded
  assert.equal(cal.inResultsBlackout('TCS'), null);
});

test('inResultsBlackout returns null for empty/invalid symbol', () => {
  const cal = buildCal([]);
  assert.equal(cal.inResultsBlackout(''), null);
  assert.equal(cal.inResultsBlackout(null), null);
  assert.equal(cal.inResultsBlackout(undefined), null);
});

test('inResultsBlackout returns null when symbol has no nearby events', () => {
  const cal = buildCal([
    { symbol: 'TCS', date: todayPlus(30), category: 'results' },
    { symbol: 'INFY', date: todayPlus(45), category: 'results' },
  ]);
  // TCS event is 30 days out — well outside the default ±3-day window.
  assert.equal(cal.inResultsBlackout('TCS'), null);
});

test('inResultsBlackout returns blackout for symbol with results in next 2 days', () => {
  const cal = buildCal([
    { symbol: 'HDFCBANK', date: todayPlus(2), category: 'quarterly_results' },
  ]);
  const r = cal.inResultsBlackout('HDFCBANK');
  assert.ok(r, 'expected blackout object');
  assert.equal(r.inBlackout, true);
  assert.ok(nearby(r.daysUntil, 2), `daysUntil should be ~2, got ${r.daysUntil}`);
  assert.equal(r.category, 'quarterly_results');
});

test('inResultsBlackout returns blackout for symbol with results 2 days ago', () => {
  const cal = buildCal([
    { symbol: 'RELIANCE', date: todayPlus(-2), category: 'annual_results' },
  ]);
  const r = cal.inResultsBlackout('RELIANCE');
  assert.ok(r);
  assert.equal(r.inBlackout, true);
  assert.ok(nearby(r.daysUntil, -2), `daysUntil should be ~-2, got ${r.daysUntil}`);
});

test('inResultsBlackout is case-insensitive on symbol', () => {
  const cal = buildCal([
    { symbol: 'TCS', date: todayPlus(1), category: 'results' },
  ]);
  assert.ok(cal.inResultsBlackout('tcs'));
  assert.ok(cal.inResultsBlackout(' Tcs '));
});

test('inResultsBlackout respects windowDays override', () => {
  const cal = buildCal([
    { symbol: 'INFY', date: todayPlus(5), category: 'results' },
  ]);
  // Default window is ±3 → 5 days out is NOT in blackout.
  assert.equal(cal.inResultsBlackout('INFY'), null);
  // Wider window catches it.
  const r = cal.inResultsBlackout('INFY', { windowDays: 7 });
  assert.ok(r);
  assert.equal(r.inBlackout, true);
  assert.ok(nearby(r.daysUntil, 5), `daysUntil should be ~5, got ${r.daysUntil}`);
});

test('inResultsBlackout ignores non-results categories (dividend, record_date)', () => {
  const cal = buildCal([
    { symbol: 'WIPRO', date: todayPlus(1), category: 'dividend' },
    { symbol: 'WIPRO', date: todayPlus(2), category: 'record_date' },
  ]);
  // Dividends + record dates don't trigger the gate (T-125 carve-out).
  assert.equal(cal.inResultsBlackout('WIPRO'), null);
});

test('inResultsBlackout picks the first matching event in the window', () => {
  const cal = buildCal([
    { symbol: 'AXISBANK', date: todayPlus(1), category: 'quarterly_results' },
    { symbol: 'AXISBANK', date: todayPlus(2), category: 'results' },
  ]);
  const r = cal.inResultsBlackout('AXISBANK');
  assert.ok(r);
  assert.equal(r.inBlackout, true);
  // Returns the first match — which has daysUntil ~1.
  assert.ok(nearby(r.daysUntil, 1), `daysUntil should be ~1, got ${r.daysUntil}`);
});

test('parseNseDate handles NSE DD-Mon-YYYY format', () => {
  // The actual NSE export format (verified live).
  const d = parseNseDate('18-May-2026');
  assert.ok(d instanceof Date);
  assert.equal(d.getUTCFullYear(), 2026);
  assert.equal(d.getUTCMonth(), 4);   // May = 4
  assert.equal(d.getUTCDate(), 18);

  // Invalid inputs return null (not throw).
  assert.equal(parseNseDate(''), null);
  assert.equal(parseNseDate(null), null);
  assert.equal(parseNseDate('not a date'), null);
  assert.equal(parseNseDate('2026-05-18'), null);   // ISO NOT supported
  assert.equal(parseNseDate('18-Xxx-2026'), null);  // bogus month
});

test('categorise maps NSE purpose strings to internal categories', () => {
  // Implementation: lowercase substring match in priority order.
  assert.equal(categorise('Quarterly Financial Results'), 'results');
  assert.equal(categorise('Interim Dividend declared'), 'dividend');
  assert.equal(categorise('Bonus Issue'), 'bonus');
  assert.equal(categorise('Stock Split'), 'split');
  assert.equal(categorise('Buy Back of Shares'), 'buyback');
  // NSE uses the literal acronym 'AGM' / 'EGM' in purpose strings.
  assert.equal(categorise('AGM dated 28-Jun-2026'), 'agm');
  assert.equal(categorise('EGM record date'), 'egm');
  assert.equal(categorise('Random unrelated text'), 'other');
  assert.equal(categorise(''), 'other');
  assert.equal(categorise(null), 'other');
});

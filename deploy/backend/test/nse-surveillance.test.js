// nse-surveillance.test.js — T-151 regression guard for nse-surveillance.js.
//
// The NseSurveillance classifier decides which NSE symbols are too risky
// for ATS to trade. It's consulted by:
//   - T-126 /api/me/paper/promote-check (gate 2: surveillance)
//   - T-125 scanner E2 gate (surveillance suppression before signals fire)
//
// A polarity flip (treating clean symbols as restricted, or vice-versa)
// silently lets the scanner promote T2T/GSM/ASM names to live — exactly
// the failure mode the gate exists to prevent.

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { NseSurveillance } = require('../nse-surveillance');

// ---------- fixtures ----------
function buildCal({ t2t = [], gsm = {}, asm = {} } = {}) {
  // Seed the internal _cache directly so we never hit nseindia.com.
  const s = new NseSurveillance({ fetchImpl: async () => ({ ok: false }) });
  s._cache = {
    ts: Date.now(),
    fetchedMs: 5,
    t2t: new Set(t2t),
    gsm: new Map(Object.entries(gsm).map(([k, v]) => [k, { stage: v }])),
    asm: new Map(Object.entries(asm).map(([k, v]) => [k, { stage: v }])),
    counts: { t2t: t2t.length, gsm: Object.keys(gsm).length, asm: Object.keys(asm).length },
  };
  return s;
}

// ---------- cold cache ----------

test('classifySync returns null when cache not warmed', () => {
  const s = new NseSurveillance({ fetchImpl: async () => ({ ok: false }) });
  assert.equal(s.classifySync('SUZLON'), null);
});

test('status() reports ready:false before cache warms', () => {
  const s = new NseSurveillance({ fetchImpl: async () => ({ ok: false }) });
  assert.deepEqual(s.status(), { ready: false });
});

// ---------- clean symbols ----------

test('classifySync returns null for symbols not in any list', () => {
  const s = buildCal({ t2t: ['SUZLON'], gsm: { YESBANK: 2 }, asm: { JPPOWER: 3 } });
  assert.equal(s.classifySync('TCS'), null);
  assert.equal(s.classifySync('RELIANCE'), null);
  assert.equal(s.classifySync('HDFCBANK'), null);
});

// ---------- T2T ----------

test('classifySync flags T2T-series symbols with reason:t2t', () => {
  const s = buildCal({ t2t: ['SUZLON', 'YESBANK', 'JPPOWER'] });
  const r = s.classifySync('SUZLON');
  assert.ok(r, 'expected classification object');
  assert.equal(r.reason, 't2t');
  assert.equal(r.list, 'T2T');
  assert.equal(r.stage, null);
});

test('classifySync T2T check is case-insensitive + whitespace-tolerant', () => {
  const s = buildCal({ t2t: ['SUZLON'] });
  assert.ok(s.classifySync('suzlon'));
  assert.ok(s.classifySync(' Suzlon '));
});

// ---------- GSM ----------

test('classifySync flags GSM stage >=2 in lenient (default) mode', () => {
  const s = buildCal({ gsm: { YESBANK: 2, SADBHAV: 3, MOIL: 4 } });
  const r1 = s.classifySync('YESBANK');
  assert.ok(r1);
  assert.equal(r1.reason, 'gsm_stage_2');
  assert.equal(r1.list, 'GSM');
  assert.equal(r1.stage, 2);

  assert.equal(s.classifySync('SADBHAV').reason, 'gsm_stage_3');
  assert.equal(s.classifySync('MOIL').reason, 'gsm_stage_4');
});

test('classifySync IGNORES GSM stage 0/1 in lenient (default) mode', () => {
  // Lenient default: minGsm = 2.
  const s = buildCal({ gsm: { LOWRISK0: 0, LOWRISK1: 1 } });
  assert.equal(s.classifySync('LOWRISK0'), null, 'stage 0 should pass lenient');
  assert.equal(s.classifySync('LOWRISK1'), null, 'stage 1 should pass lenient');
});

test('classifySync FLAGS GSM stage 0/1 in strict mode', () => {
  // Strict mode: minGsm = 0 — any GSM listing is restricted.
  const s = buildCal({ gsm: { LOWRISK0: 0, LOWRISK1: 1 } });
  const r0 = s.classifySync('LOWRISK0', { strict: true });
  assert.ok(r0);
  assert.equal(r0.stage, 0);
  assert.equal(r0.reason, 'gsm_stage_0');

  const r1 = s.classifySync('LOWRISK1', { strict: true });
  assert.ok(r1);
  assert.equal(r1.stage, 1);
});

// ---------- ASM ----------

test('classifySync flags ASM stage >=3 in lenient (default) mode', () => {
  const s = buildCal({ asm: { HIGHRISK: 3, ALERT4: 4 } });
  const r3 = s.classifySync('HIGHRISK');
  assert.ok(r3);
  assert.equal(r3.list, 'ASM');
  assert.equal(r3.stage, 3);
  assert.equal(r3.reason, 'asm_stage_3');

  assert.equal(s.classifySync('ALERT4').stage, 4);
});

test('classifySync IGNORES ASM stage 1/2 in lenient mode but FLAGS in strict', () => {
  const s = buildCal({ asm: { LOWASM1: 1, LOWASM2: 2 } });
  assert.equal(s.classifySync('LOWASM1'), null);
  assert.equal(s.classifySync('LOWASM2'), null);

  // Strict: minAsm = 1.
  assert.equal(s.classifySync('LOWASM1', { strict: true }).stage, 1);
  assert.equal(s.classifySync('LOWASM2', { strict: true }).stage, 2);
});

// ---------- precedence ----------

test('T2T takes precedence over GSM + ASM when symbol is on multiple lists', () => {
  const s = buildCal({
    t2t: ['MULTILIST'],
    gsm: { MULTILIST: 4 },
    asm: { MULTILIST: 4 },
  });
  const r = s.classifySync('MULTILIST');
  assert.equal(r.reason, 't2t', 'T2T must win — most restrictive');
  assert.equal(r.list, 'T2T');
});

test('GSM takes precedence over ASM when both apply (no T2T)', () => {
  const s = buildCal({
    gsm: { GSMASM: 3 },
    asm: { GSMASM: 4 },
  });
  const r = s.classifySync('GSMASM');
  assert.equal(r.list, 'GSM');
  assert.equal(r.stage, 3);
});

// ---------- edge cases ----------

test('classifySync returns null for empty/null/undefined symbol', () => {
  const s = buildCal({ t2t: ['SUZLON'] });
  assert.equal(s.classifySync(''), null);
  assert.equal(s.classifySync(null), null);
  assert.equal(s.classifySync(undefined), null);
});

test('status() reports counts + age after warm cache', () => {
  const s = buildCal({ t2t: ['A', 'B'], gsm: { C: 2 }, asm: { D: 3 } });
  const st = s.status();
  assert.equal(st.ready, true);
  assert.deepEqual(st.counts, { t2t: 2, gsm: 1, asm: 1 });
  assert.ok(typeof st.ageMs === 'number' && st.ageMs >= 0);
});

// ---------- _splitCsv (CSV parser unit) ----------

test('_splitCsv handles plain comma-separated fields', () => {
  const s = new NseSurveillance({ fetchImpl: async () => ({}) });
  assert.deepEqual(s._splitCsv('A,B,C,D'), ['A', 'B', 'C', 'D']);
});

test('_splitCsv handles quoted fields containing commas', () => {
  const s = new NseSurveillance({ fetchImpl: async () => ({}) });
  assert.deepEqual(
    s._splitCsv('SYMBOL,"Some Company, Inc.",EQ,1000'),
    ['SYMBOL', 'Some Company, Inc.', 'EQ', '1000']
  );
});

test('_splitCsv handles empty fields', () => {
  const s = new NseSurveillance({ fetchImpl: async () => ({}) });
  assert.deepEqual(s._splitCsv('A,,C,,'), ['A', '', 'C', '', '']);
});

test('_splitCsv handles trailing empty field', () => {
  const s = new NseSurveillance({ fetchImpl: async () => ({}) });
  const r = s._splitCsv('A,B,');
  assert.equal(r.length, 3);
  assert.equal(r[2], '');
});

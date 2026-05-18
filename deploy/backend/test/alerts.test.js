// alerts.test.js — T-152 regression guard for alerts.js.
//
// The Alerts engine runs on every WS tick (50+ Hz hot path). Its job is to
// fire telegram + audit when a user-configured threshold is crossed.
//
// Regressions to guard:
//   - threshold polarity flips (above fires below price, vice-versa)
//   - one-shot fires multiple times (notification spam)
//   - repeat alerts never re-fire (silent fail)
//   - hot path does I/O (slows the tick loop to a crawl)

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Alerts } = require('../alerts');

// ---------- fixtures ----------
function tmpStore() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ats-alerts-test-'));
  return path.join(dir, '_alerts.json');
}

function build({ notify, audit } = {}) {
  const notifyCalls = [];
  const auditCalls = [];
  const a = new Alerts({
    storePath: tmpStore(),
    notify: notify || ((level, title, details) => {
      notifyCalls.push({ level, title, details });
      return Promise.resolve();
    }),
    audit: audit || ((event, data) => auditCalls.push({ event, data })),
  });
  return { a, notifyCalls, auditCalls };
}

// ---------- add validation ----------

test('add throws on missing/empty symbol', () => {
  const { a } = build();
  assert.throws(() => a.add({ condition: 'above', threshold: 100 }), /symbol required/);
  assert.throws(() => a.add({ symbol: '', condition: 'above', threshold: 100 }), /symbol required/);
  assert.throws(() => a.add({ symbol: '   ', condition: 'above', threshold: 100 }), /symbol required/);
});

test('add throws on invalid condition', () => {
  const { a } = build();
  assert.throws(() => a.add({ symbol: 'X', condition: 'cross', threshold: 1 }), /above\|below/);
  assert.throws(() => a.add({ symbol: 'X', condition: 'equal', threshold: 1 }), /above\|below/);
});

test('add throws on non-numeric threshold', () => {
  const { a } = build();
  assert.throws(() => a.add({ symbol: 'X', condition: 'above', threshold: 'high' }), /numeric/);
  assert.throws(() => a.add({ symbol: 'X', condition: 'above', threshold: NaN }), /numeric/);
});

test('add returns an alert with id + sane defaults', () => {
  const { a, auditCalls } = build();
  const al = a.add({ symbol: ' RELIANCE ', condition: 'above', threshold: 2900 });
  assert.ok(typeof al.id === 'string' && al.id.length > 0);
  assert.equal(al.symbol, 'RELIANCE');   // trimmed
  assert.equal(al.condition, 'above');
  assert.equal(al.threshold, 2900);
  assert.equal(al.triggeredAt, null);
  assert.equal(al.triggerCount, 0);
  assert.equal(al.repeat, false);
  // audit fired
  assert.equal(auditCalls[0].event, 'alert.add');
  assert.equal(auditCalls[0].data.symbol, 'RELIANCE');
});

// ---------- list ----------

test('list returns immutable copies (caller mutation must not affect store)', () => {
  const { a } = build();
  a.add({ symbol: 'X', condition: 'above', threshold: 1 });
  const items = a.list();
  items[0].symbol = 'HACKED';
  assert.equal(a.list()[0].symbol, 'X', 'caller must not mutate via list()');
});

// ---------- evaluate: above ----------

test('evaluate(above) fires when ltp >= threshold', () => {
  const { a, notifyCalls, auditCalls } = build();
  a.add({ symbol: 'TCS', condition: 'above', threshold: 3000 });
  a.evaluate({ symbol: 'TCS', ltp: 3001, ts: 1 });
  assert.equal(notifyCalls.length, 1);
  assert.equal(notifyCalls[0].level, 'warn');
  assert.match(notifyCalls[0].title, /↗ TCS above 3000/);
  const fires = auditCalls.filter(c => c.event === 'alert.fire');
  assert.equal(fires.length, 1);
});

test('evaluate(above) does NOT fire when ltp < threshold', () => {
  const { a, notifyCalls } = build();
  a.add({ symbol: 'TCS', condition: 'above', threshold: 3000 });
  a.evaluate({ symbol: 'TCS', ltp: 2999, ts: 1 });
  assert.equal(notifyCalls.length, 0);
});

test('evaluate(above) fires at exactly threshold (>= boundary)', () => {
  const { a, notifyCalls } = build();
  a.add({ symbol: 'TCS', condition: 'above', threshold: 3000 });
  a.evaluate({ symbol: 'TCS', ltp: 3000, ts: 1 });
  assert.equal(notifyCalls.length, 1);
});

// ---------- evaluate: below ----------

test('evaluate(below) fires when ltp <= threshold', () => {
  const { a, notifyCalls } = build();
  a.add({ symbol: 'INFY', condition: 'below', threshold: 1500 });
  a.evaluate({ symbol: 'INFY', ltp: 1499, ts: 1 });
  assert.equal(notifyCalls.length, 1);
  assert.match(notifyCalls[0].title, /↘ INFY below 1500/);
});

test('evaluate(below) does NOT fire when ltp > threshold', () => {
  const { a, notifyCalls } = build();
  a.add({ symbol: 'INFY', condition: 'below', threshold: 1500 });
  a.evaluate({ symbol: 'INFY', ltp: 1501, ts: 1 });
  assert.equal(notifyCalls.length, 0);
});

// ---------- one-shot vs repeat ----------

test('one-shot alert fires exactly ONCE even on repeated threshold crossings', () => {
  const { a, notifyCalls } = build();
  a.add({ symbol: 'TCS', condition: 'above', threshold: 3000 });
  a.evaluate({ symbol: 'TCS', ltp: 3001, ts: 1 });
  a.evaluate({ symbol: 'TCS', ltp: 3050, ts: 2 });
  a.evaluate({ symbol: 'TCS', ltp: 3100, ts: 3 });
  assert.equal(notifyCalls.length, 1, 'one-shot must not spam notifications');
});

test('repeat alert can re-fire after price crosses back through threshold', () => {
  const { a, notifyCalls } = build();
  a.add({ symbol: 'TCS', condition: 'above', threshold: 3000, repeat: true });
  // 1st cross-up
  a.evaluate({ symbol: 'TCS', ltp: 3001, ts: 1 });
  assert.equal(notifyCalls.length, 1);
  // Drop below — uncross
  a.evaluate({ symbol: 'TCS', ltp: 2990, ts: 2 });
  // 2nd cross-up
  a.evaluate({ symbol: 'TCS', ltp: 3010, ts: 3 });
  assert.equal(notifyCalls.length, 2, 'repeat must re-fire after uncross');
});

test('repeat alert does NOT re-fire while price stays above threshold', () => {
  const { a, notifyCalls } = build();
  a.add({ symbol: 'TCS', condition: 'above', threshold: 3000, repeat: true });
  a.evaluate({ symbol: 'TCS', ltp: 3001, ts: 1 });
  a.evaluate({ symbol: 'TCS', ltp: 3050, ts: 2 });  // still above — no fire
  a.evaluate({ symbol: 'TCS', ltp: 3100, ts: 3 });  // still above — no fire
  assert.equal(notifyCalls.length, 1);
});

// ---------- remove / reset ----------

test('remove deletes by id and returns true; false on miss', () => {
  const { a } = build();
  const al = a.add({ symbol: 'X', condition: 'above', threshold: 1 });
  assert.equal(a.remove(al.id), true);
  assert.equal(a.list().length, 0);
  assert.equal(a.remove('nope'), false);
});

test('reset clears triggeredAt so a one-shot can fire again', () => {
  const { a, notifyCalls } = build();
  const al = a.add({ symbol: 'TCS', condition: 'above', threshold: 3000 });
  a.evaluate({ symbol: 'TCS', ltp: 3001, ts: 1 });
  assert.equal(notifyCalls.length, 1);
  // Without reset, second cross does nothing for one-shot
  a.evaluate({ symbol: 'TCS', ltp: 3010, ts: 2 });
  assert.equal(notifyCalls.length, 1);
  // After reset, fires again
  a.reset(al.id);
  a.evaluate({ symbol: 'TCS', ltp: 3020, ts: 3 });
  assert.equal(notifyCalls.length, 2);
});

// ---------- stats ----------

test('stats counts evals/fires/total/active/triggered/symbols', () => {
  const { a } = build();
  a.add({ symbol: 'TCS', condition: 'above', threshold: 3000 });
  a.add({ symbol: 'INFY', condition: 'below', threshold: 1500 });
  a.add({ symbol: 'TCS', condition: 'below', threshold: 2900 });  // same symbol

  a.evaluate({ symbol: 'TCS', ltp: 3001, ts: 1 });   // fires above
  a.evaluate({ symbol: 'INFY', ltp: 1499, ts: 2 });  // fires below
  a.evaluate({ symbol: 'TCS', ltp: 2950, ts: 3 });   // no cross (still above 2900)

  const s = a.stats();
  assert.equal(s.total, 3);
  assert.equal(s.triggered, 2);
  assert.equal(s.symbols, 2);
  assert.ok(s.evals >= 3);
  assert.equal(s.fires, 2);
});

// ---------- hot path: no I/O ----------

test('evaluate does NOT write to disk synchronously (writes are debounced)', () => {
  // Spy on fs.writeFileSync to detect any synchronous writes during evaluate.
  const real = fs.writeFileSync;
  let writes = 0;
  fs.writeFileSync = function (...args) {
    writes++;
    return real.apply(fs, args);
  };
  try {
    const { a } = build();
    writes = 0;  // reset after add() persists
    a.add({ symbol: 'TCS', condition: 'above', threshold: 3000 });
    const baseline = writes;
    // 100 ticks
    for (let i = 0; i < 100; i++) {
      a.evaluate({ symbol: 'TCS', ltp: 3001 + i, ts: i });
    }
    assert.equal(writes, baseline,
      `evaluate must not write to disk on the hot path (saw ${writes - baseline} writes for 100 ticks)`);
  } finally {
    fs.writeFileSync = real;
  }
});

// ---------- edge cases ----------

test('evaluate ignores malformed ticks', () => {
  const { a, notifyCalls } = build();
  a.add({ symbol: 'TCS', condition: 'above', threshold: 3000 });
  a.evaluate(null);
  a.evaluate(undefined);
  a.evaluate({});
  a.evaluate({ symbol: 'TCS' });           // no ltp
  a.evaluate({ symbol: 'TCS', ltp: 'high' }); // non-numeric ltp
  a.evaluate({ ltp: 3001 });               // no symbol
  assert.equal(notifyCalls.length, 0);
});

test('evaluate is a no-op for symbols with no alerts (index miss is fast)', () => {
  const { a, notifyCalls } = build();
  a.add({ symbol: 'TCS', condition: 'above', threshold: 3000 });
  a.evaluate({ symbol: 'RELIANCE', ltp: 99999, ts: 1 });
  assert.equal(notifyCalls.length, 0);
});

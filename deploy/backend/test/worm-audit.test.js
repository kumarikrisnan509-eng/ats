const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { WormAudit, GENESIS_PREV, hashEntry, canonicalize } = require('../worm-audit');

function tmpFile(name) {
  return path.join(os.tmpdir(), `worm-test-${name}-${Date.now()}-${Math.random().toString(36).slice(2)}.jsonl`);
}

test('canonicalize: stable across key order', () => {
  const a = canonicalize({ b: 2, a: 1, c: { z: 9, y: 8 } });
  const b = canonicalize({ c: { y: 8, z: 9 }, a: 1, b: 2 });
  assert.equal(a, b);
});

test('fresh init: empty file, count=0, headHash = genesis', () => {
  const w = new WormAudit({ path: tmpFile('fresh-init') });
  const r = w.init();
  assert.equal(r.ok, true);
  assert.equal(r.fresh, true);
  assert.equal(r.count, 0);
  const root = w.root();
  assert.equal(root.headSeq, 0);
  assert.equal(root.headHash, GENESIS_PREV);
});

test('append: 3 entries, verify ok, hashes chain', () => {
  const p = tmpFile('append-3');
  const w = new WormAudit({ path: p });
  w.init();
  const r1 = w.append('order.placed', { id: 'A', qty: 50 });
  const r2 = w.append('order.filled', { id: 'A', qty: 50, price: 22000 });
  const r3 = w.append('paper.realizedPnL', { value: 1500.25 });

  assert.equal(r1.seq, 1);
  assert.equal(r2.seq, 2);
  assert.equal(r3.seq, 3);

  // verify the chain
  const v = w.verify();
  assert.equal(v.ok, true);
  assert.equal(v.totalEntries, 3);
  assert.equal(v.headSeq, 3);
  assert.equal(v.headHash, r3.hash);
  assert.equal(v.brokenAt, null);

  // file is 3 lines
  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  assert.equal(lines.length, 3);
  const last = JSON.parse(lines[2]);
  assert.equal(last.prevHash, r2.hash);

  fs.unlinkSync(p);
});

test('tamper: flip a byte in the data of entry 2 -> verify catches it at seq=2', () => {
  const p = tmpFile('tamper-byte');
  const w = new WormAudit({ path: p });
  w.init();
  w.append('order.placed', { id: 'A', qty: 50 });
  w.append('order.placed', { id: 'B', qty: 75 });
  w.append('order.placed', { id: 'C', qty: 100 });

  // Mutate entry 2: change qty 75 -> 9999 directly in the file
  let raw = fs.readFileSync(p, 'utf8');
  raw = raw.replace('"qty":75', '"qty":9999');
  fs.writeFileSync(p, raw);

  const v = w.verify();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 2);
  assert.equal(v.reason, 'hash-mismatch');

  fs.unlinkSync(p);
});

test('tamper: delete entry 2 -> verify catches seq discontinuity', () => {
  const p = tmpFile('tamper-delete');
  const w = new WormAudit({ path: p });
  w.init();
  w.append('a', { x: 1 });
  w.append('b', { x: 2 });
  w.append('c', { x: 3 });

  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  // Remove line 2
  fs.writeFileSync(p, [lines[0], lines[2]].join('\n') + '\n');

  const v = w.verify();
  assert.equal(v.ok, false);
  // After entry 1 (seq=1), the next entry has seq=3 instead of 2.
  assert.equal(v.brokenAt, 3);
  assert.equal(v.reason, 'seq-discontinuity');

  fs.unlinkSync(p);
});

test('tamper: corrupt JSON in entry 2 -> verify catches malformed-json', () => {
  const p = tmpFile('tamper-json');
  const w = new WormAudit({ path: p });
  w.init();
  w.append('a', { x: 1 });
  w.append('b', { x: 2 });

  const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
  // Replace line 2 with garbage
  fs.writeFileSync(p, lines[0] + '\nNOT_VALID_JSON\n');

  const v = w.verify();
  assert.equal(v.ok, false);
  assert.equal(v.reason, 'malformed-json');

  fs.unlinkSync(p);
});

test('re-init after existing entries: lastSeq + headHash advance correctly', () => {
  const p = tmpFile('reinit');
  const w1 = new WormAudit({ path: p });
  w1.init();
  w1.append('e1', { v: 1 });
  w1.append('e2', { v: 2 });
  const firstRoot = w1.root();

  // Simulate a process restart: new WormAudit picks up where w1 left off.
  const w2 = new WormAudit({ path: p });
  const r = w2.init();
  assert.equal(r.ok, true);
  assert.equal(r.fresh, false);
  assert.equal(r.count, 2);

  const r3 = w2.append('e3', { v: 3 });
  assert.equal(r3.seq, 3);

  const v = w2.verify();
  assert.equal(v.ok, true);
  assert.equal(v.totalEntries, 3);
  assert.equal(v.headHash, r3.hash);
  assert.notEqual(v.headHash, firstRoot.headHash);

  fs.unlinkSync(p);
});

test('merkle root: deterministic for same chain, changes with new entry', () => {
  const p = tmpFile('merkle');
  const w = new WormAudit({ path: p });
  w.init();
  w.append('a', { v: 1 });
  w.append('b', { v: 2 });
  w.append('c', { v: 3 });

  const root1 = w.root();
  // Re-read the same file with a fresh instance -- merkle should match
  const w2 = new WormAudit({ path: p });
  w2.init();
  const root2 = w2.root();
  assert.equal(root1.merkleRoot, root2.merkleRoot);

  // Append one more, merkle should change
  w.append('d', { v: 4 });
  const root3 = w.root();
  assert.notEqual(root3.merkleRoot, root1.merkleRoot);
  assert.equal(root3.count, 4);

  fs.unlinkSync(p);
});

test('onMerkle callback fires every merkleEvery entries', () => {
  const p = tmpFile('merkle-cb');
  const fired = [];
  const w = new WormAudit({
    path: p,
    merkleEvery: 3,
    onMerkle: (label, root, range) => fired.push({ label, root, range }),
  });
  w.init();
  w.append('a', { v: 1 });
  w.append('b', { v: 2 });
  w.append('c', { v: 3 });    // <- should fire (seq=3, merkleEvery=3)
  w.append('d', { v: 4 });
  w.append('e', { v: 5 });
  w.append('f', { v: 6 });    // <- should fire

  assert.equal(fired.length, 2);
  assert.equal(fired[0].label, 'worm.merkle');
  assert.deepEqual(fired[0].range, { from: 1, to: 3 });
  assert.deepEqual(fired[1].range, { from: 4, to: 6 });
  assert.notEqual(fired[0].root, fired[1].root);

  fs.unlinkSync(p);
});

test('append throws if not initialized', () => {
  const w = new WormAudit({ path: tmpFile('no-init') });
  assert.throws(() => w.append('x', {}), /not initialized/);
});

test('append rejects empty event name', () => {
  const w = new WormAudit({ path: tmpFile('empty-event') });
  w.init();
  assert.throws(() => w.append('', { x: 1 }), /non-empty string/);
  assert.throws(() => w.append(null, { x: 1 }), /non-empty string/);
});

test('tail returns last N entries in order', () => {
  const p = tmpFile('tail');
  const w = new WormAudit({ path: p });
  w.init();
  for (let i = 1; i <= 10; i++) w.append('e', { i });
  const last3 = w.tail(3);
  assert.equal(last3.length, 3);
  assert.equal(last3[0].data.i, 8);
  assert.equal(last3[2].data.i, 10);
  fs.unlinkSync(p);
});

test('hashEntry: hash changes when ANY field changes', () => {
  const base = { seq: 1, ts: '2026-05-15T00:00:00.000Z', event: 'a', data: { x: 1 }, prevHash: GENESIS_PREV };
  const h0 = hashEntry(base);
  assert.notEqual(hashEntry({ ...base, seq: 2 }), h0);
  assert.notEqual(hashEntry({ ...base, ts: '2026-05-15T00:00:00.001Z' }), h0);
  assert.notEqual(hashEntry({ ...base, event: 'b' }), h0);
  assert.notEqual(hashEntry({ ...base, data: { x: 2 } }), h0);
  assert.notEqual(hashEntry({ ...base, prevHash: '0'.repeat(63) + '1' }), h0);
});

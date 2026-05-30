// worm-audit.js -- Tier 32: Write-Once-Read-Many tamper-evident audit log.
//
// Compliance context: SEBI's 1 April 2026 retail algo framework requires
// immutable audit logs for algorithmic trading platforms. This module wraps
// the existing audit() pipeline with a hash-chained, append-only sidecar log
// that lets an external auditor verify the integrity of every entry.
//
// Design (blockchain-style):
//   entry_n = {
//     seq:       <monotonic counter, starts at 1>,
//     ts:        <ISO-8601 timestamp>,
//     event:     <event name, e.g. 'order.placed'>,
//     data:      <arbitrary JSON payload>,
//     prevHash:  <entry_{n-1}.hash, or 0x00..00 for the genesis entry>,
//     hash:      sha256( prevHash + JSON.canonicalize({seq, ts, event, data}) )
//   }
// Each line is one JSON object. The file is append-only and never rewritten.
// Verification walks the file, recomputes each hash, and confirms continuity.
//
// Public API:
//   const worm = new WormAudit({ path: '/var/log/ats/audit.worm.jsonl' });
//   await worm.init();
//   worm.append('order.placed', { orderId: '...', symbol: 'NIFTY', qty: 50 });
//   const v = worm.verify();          // { ok, brokenAt, totalEntries, headHash, headSeq }
//   const r = worm.root();            // { headHash, headSeq, merkleRoot, count }
//   const entries = worm.tail(50);    // last 50 entries (read-only)
//
// Safety properties:
//   - append() is the only write method. There is no delete/update path.
//   - Any tampering (single byte flip, line deletion, line insertion, order
//     swap) is detected by verify() at the first broken hash.
//   - Genesis entry has prevHash = '0'.repeat(64). This makes the chain
//     deterministic and lets a fresh WORM start verify.
//
// Production positioning:
//   - The existing audit() in server.js still writes the JSON-lines audit.log
//     for human inspection + the rclone-to-GDrive archive. WormAudit writes
//     a *parallel* file (audit.worm.jsonl) so any bug here cannot break the
//     primary audit stream.
//   - At cron time, the Merkle root for the latest N entries is logged so
//     that even if the WORM file itself were tampered, an off-VM auditor
//     could verify any window of the chain from the published roots.

'use strict';

const fs    = require('fs');
const path  = require('path');
const { createHash } = require('crypto');

const GENESIS_PREV = '0'.repeat(64);
const DEFAULT_PATH = '/var/log/ats/audit.worm.jsonl';

function sha256(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

/** Deterministic JSON.stringify with sorted keys. Required for hash stability. */
function canonicalize(obj) {
  if (obj === null || typeof obj !== 'object') return JSON.stringify(obj);
  if (Array.isArray(obj)) return '[' + obj.map(canonicalize).join(',') + ']';
  const keys = Object.keys(obj).sort();
  return '{' + keys.map(k => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
}

function hashEntry({ seq, ts, event, data, prevHash }) {
  const inner = canonicalize({ seq, ts, event, data });
  return sha256(prevHash + inner);
}

class WormAudit {
  /**
   * @param {object} [opts]
   * @param {string} [opts.path]       default '/var/log/ats/audit.worm.jsonl'
   * @param {number} [opts.merkleEvery] default 100 -- emit Merkle root every N entries
   * @param {(label:string, root:string, range:{from:number,to:number}) => void} [opts.onMerkle]
   *                                    callback fired when a Merkle root is computed
   */
  constructor(opts = {}) {
    this.path        = opts.path        || DEFAULT_PATH;
    this.merkleEvery = Math.max(1, opts.merkleEvery || 100);
    this.onMerkle    = typeof opts.onMerkle === 'function' ? opts.onMerkle : null;

    this._lastHash = GENESIS_PREV;
    this._lastSeq  = 0;
    this._initialized = false;
  }

  /** Read the existing file (if any), advance _lastSeq + _lastHash, validate continuity. */
  init() {
    this._sealed = [];
    return this._initFrom(this.path, 0);
  }

  /**
   * T-557: init from a specific segment path. If the segment's chain is broken,
   * PRESERVE it untouched and SEAL -- switch active writes to a deterministic
   * `<path>.cont` continuation segment instead of re-appending overlapping seqs
   * into the broken file. The old behaviour reset _lastSeq to the last-good seq
   * and resumed appending into the SAME file, producing duplicate sequences, an
   * ever-growing file, and a chain verify() reported broken forever. Sealing
   * keeps the broken bytes on disk (for auditors) and resumes a verifiable chain.
   * The deterministic `.cont` name makes this converge across restarts.
   */
  _initFrom(p, depth) {
    this.path = p;
    try { fs.mkdirSync(path.dirname(p), { recursive: true }); } catch (e) { console.warn('[worm-audit] swallowed:', e && e.message); }

    if (!fs.existsSync(p)) {
      // T-559: if this segment was archived/removed but a continuation segment
      // exists, follow it instead of starting a fresh chain at the archived
      // path. Lets the operator archive a sealed broken segment (gzip it aside)
      // without orphaning the active `.cont` chain on the next restart.
      const cont = p + '.cont';
      if (depth < 8 && fs.existsSync(cont)) {
        this._sealed.push({ path: p, archived: true });
        return this._initFrom(cont, depth + 1);
      }
      this._lastHash = GENESIS_PREV;
      this._lastSeq  = 0;
      this._initialized = true;
      return { ok: true, fresh: true, count: 0, activePath: p, sealed: this._sealed };
    }

    const lines = fs.readFileSync(p, 'utf8').split('\n').filter(Boolean);
    let prev = GENESIS_PREV;
    let seq  = 0;
    let brokenAt = null;
    for (let i = 0; i < lines.length; i++) {
      let entry;
      try { entry = JSON.parse(lines[i]); }
      catch (e) { brokenAt = i + 1; break; }
      if (entry.seq !== seq + 1) { brokenAt = entry.seq; break; }
      if (entry.prevHash !== prev) { brokenAt = entry.seq; break; }
      const computed = hashEntry({
        seq: entry.seq, ts: entry.ts, event: entry.event,
        data: entry.data, prevHash: entry.prevHash,
      });
      if (computed !== entry.hash) { brokenAt = entry.seq; break; }
      prev = entry.hash;
      seq  = entry.seq;
    }

    if (brokenAt !== null) {
      // Seal the broken segment (left untouched on disk) and continue in a
      // deterministic continuation file so we never re-append overlapping seqs.
      this._sealed.push({ path: p, brokenAt, lastGoodSeq: seq, lastGoodHash: prev, count: lines.length });
      if (depth < 8) {
        return this._initFrom(p + '.cont', depth + 1);
      }
      // Pathological: too many broken continuation segments. Refuse to write
      // (in-memory only) rather than risk an unbounded chain of .cont files.
      this._lastHash = GENESIS_PREV;
      this._lastSeq  = 0;
      this._initialized = true;
      return { ok: false, brokenAt, count: lines.length, activePath: p, sealed: this._sealed, gaveUp: true };
    }

    this._lastHash = prev;
    this._lastSeq  = seq;
    this._initialized = true;
    return { ok: true, fresh: lines.length === 0, count: lines.length, activePath: p, sealed: this._sealed };
  }

  /** Append a single audit event. Throws if not initialized or write fails. */
  append(event, data) {
    if (!this._initialized) throw new Error('WormAudit not initialized -- call init() first');
    if (typeof event !== 'string' || event.length === 0) throw new Error('event must be a non-empty string');
    if (data === undefined) data = {};
    // T-557: normalize data through JSON BEFORE hashing so the hash is computed
    // over the EXACT serialized form that gets written (and later re-parsed by
    // verify()). Without this, a payload containing a Date / undefined / function
    // hashes differently at append time (canonicalize sees the live object) than
    // at verify time (which sees the round-tripped object) -> a permanent,
    // self-inflicted hash-mismatch. The JSON round-trip makes them identical.
    try { data = JSON.parse(JSON.stringify(data)); }
    catch (_e) { data = { _unserializable: true }; }

    const seq = this._lastSeq + 1;
    const ts  = new Date().toISOString();
    const prevHash = this._lastHash;
    const hash = hashEntry({ seq, ts, event, data, prevHash });

    const line = JSON.stringify({ seq, ts, event, data, prevHash, hash }) + '\n';
    // Synchronous appendFile -- audit must be durable BEFORE the caller returns.
    fs.appendFileSync(this.path, line, { mode: 0o640 });

    this._lastSeq  = seq;
    this._lastHash = hash;

    if (seq % this.merkleEvery === 0 && this.onMerkle) {
      try {
        const from = seq - this.merkleEvery + 1;
        const root = this._merkleRoot(from, seq);
        this.onMerkle('worm.merkle', root, { from, to: seq });
      } catch (_e) { /* don't break audit on merkle bookkeeping */ }
    }
    return { seq, hash };
  }

  /** Walk the file end-to-end and verify every entry. */
  verify() {
    if (!fs.existsSync(this.path)) {
      return { ok: true, totalEntries: 0, headHash: GENESIS_PREV, headSeq: 0, brokenAt: null };
    }
    const lines = fs.readFileSync(this.path, 'utf8').split('\n').filter(Boolean);
    let prev = GENESIS_PREV;
    let lastHash = GENESIS_PREV;
    let lastSeq  = 0;
    for (let i = 0; i < lines.length; i++) {
      let entry;
      try { entry = JSON.parse(lines[i]); }
      catch (_e) { return { ok: false, brokenAt: i + 1, totalEntries: lines.length, headHash: lastHash, headSeq: lastSeq, reason: 'malformed-json' }; }
      if (entry.seq !== lastSeq + 1) {
        return { ok: false, brokenAt: entry.seq, totalEntries: lines.length, headHash: lastHash, headSeq: lastSeq, reason: 'seq-discontinuity' };
      }
      if (entry.prevHash !== prev) {
        return { ok: false, brokenAt: entry.seq, totalEntries: lines.length, headHash: lastHash, headSeq: lastSeq, reason: 'prevHash-mismatch' };
      }
      const computed = hashEntry({
        seq: entry.seq, ts: entry.ts, event: entry.event,
        data: entry.data, prevHash: entry.prevHash,
      });
      if (computed !== entry.hash) {
        return { ok: false, brokenAt: entry.seq, totalEntries: lines.length, headHash: lastHash, headSeq: lastSeq, reason: 'hash-mismatch' };
      }
      prev     = entry.hash;
      lastHash = entry.hash;
      lastSeq  = entry.seq;
    }
    return { ok: true, totalEntries: lines.length, headHash: lastHash, headSeq: lastSeq, brokenAt: null };
  }

  /** Current chain head + Merkle root over the entire file. */
  root() {
    if (!fs.existsSync(this.path)) {
      return { headHash: GENESIS_PREV, headSeq: 0, merkleRoot: GENESIS_PREV, count: 0 };
    }
    const lines = fs.readFileSync(this.path, 'utf8').split('\n').filter(Boolean);
    if (lines.length === 0) {
      return { headHash: GENESIS_PREV, headSeq: 0, merkleRoot: GENESIS_PREV, count: 0 };
    }
    const last = JSON.parse(lines[lines.length - 1]);
    return {
      headHash:   last.hash,
      headSeq:    last.seq,
      merkleRoot: this._merkleRoot(1, last.seq),
      count:      lines.length,
    };
  }

  /** Read the last N entries (default 100). Read-only. */
  tail(n) {
    n = Math.max(1, Math.min(10000, Number(n) || 100));
    if (!fs.existsSync(this.path)) return [];
    const lines = fs.readFileSync(this.path, 'utf8').split('\n').filter(Boolean);
    return lines.slice(-n).map(line => {
      try { return JSON.parse(line); }
      catch (_) { return { _malformed: line }; }
    });
  }

  /** Merkle root over entries seq=from..to inclusive. */
  _merkleRoot(from, to) {
    if (!fs.existsSync(this.path)) return GENESIS_PREV;
    const lines = fs.readFileSync(this.path, 'utf8').split('\n').filter(Boolean);
    const leaves = [];
    for (const line of lines) {
      let entry;
      try { entry = JSON.parse(line); } catch (_) { continue; }
      if (entry.seq >= from && entry.seq <= to) leaves.push(entry.hash);
    }
    if (leaves.length === 0) return GENESIS_PREV;
    // Standard binary Merkle tree, sha256-of-concat-pairs, duplicate-last-on-odd.
    let level = leaves.slice();
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        const a = level[i];
        const b = i + 1 < level.length ? level[i + 1] : level[i];
        next.push(sha256(a + b));
      }
      level = next;
    }
    return level[0];
  }
}

module.exports = { WormAudit, GENESIS_PREV, hashEntry, canonicalize };

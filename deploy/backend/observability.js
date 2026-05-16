// observability.js -- Tier 70: lightweight error capture + latency monitoring.
//
// Captures unhandled route errors with request_id, user_id, method, path, status,
// duration, stack into a small SQLite table. Computes per-route latency P50/P99
// in memory (cheap, no time-series DB needed for our scale).
//
// Exposes:
//   - createObservability({ db }) -> { middleware, errorMiddleware, snapshot, perRoute }
//   - latency histogram per route key (METHOD path-pattern), rolling 1000 samples
//   - error log with bounded size (last 500 errors)

'use strict';

const crypto = require('crypto');
const MAX_SAMPLES_PER_ROUTE = 1000;

function _pcent(sortedArr, p) {
  if (!sortedArr.length) return null;
  const idx = Math.min(sortedArr.length - 1, Math.floor((p / 100) * sortedArr.length));
  return sortedArr[idx];
}

function createObservability({ db }) {
  // errors_log table (idempotent)
  if (db && db._conn) {
    db._conn.exec(`
      CREATE TABLE IF NOT EXISTS errors_log (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        ts          TEXT NOT NULL DEFAULT (datetime('now')),
        request_id  TEXT,
        user_id     INTEGER,
        method      TEXT,
        path        TEXT,
        status      INTEGER,
        duration_ms REAL,
        message     TEXT,
        stack       TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_errors_ts ON errors_log(ts DESC);
    `);
    // Keep only last 500 rows (cheap, run on insert)
    db._conn.exec("CREATE TRIGGER IF NOT EXISTS trim_errors_log AFTER INSERT ON errors_log BEGIN DELETE FROM errors_log WHERE id < (SELECT MAX(id)-500 FROM errors_log); END;");
  }

  const errorInsert = db && db._conn ? db._conn.prepare(
    "INSERT INTO errors_log (request_id, user_id, method, path, status, duration_ms, message, stack) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ) : null;

  // In-memory latency samples per route key
  /** @type {Map<string, number[]>} */
  const samplesByRoute = new Map();

  function record(routeKey, durationMs) {
    let arr = samplesByRoute.get(routeKey);
    if (!arr) { arr = []; samplesByRoute.set(routeKey, arr); }
    arr.push(durationMs);
    if (arr.length > MAX_SAMPLES_PER_ROUTE) arr.shift();
  }

  function middleware(req, res, next) {
    req.id = req.id || crypto.randomBytes(8).toString('hex');
    const t0 = process.hrtime.bigint();
    res.setHeader('x-request-id', req.id);
    res.on('finish', () => {
      const dt = Number(process.hrtime.bigint() - t0) / 1e6;
      // Use route.path when available so dynamic params collapse correctly
      const path = (req.route && req.route.path) || req.path || req.originalUrl || 'unknown';
      const key = `${req.method} ${path}`;
      record(key, dt);
    });
    next();
  }

  // Express error-handling signature (4-arg).
  function errorMiddleware(err, req, res, _next) {
    const path = (req.route && req.route.path) || req.path || req.originalUrl || 'unknown';
    const duration = req._startAt ? (Date.now() - req._startAt) : null;
    const userId = (req.user && req.user.id) || null;
    const status = err && err.status ? err.status : 500;
    try {
      if (errorInsert) {
        errorInsert.run(
          req.id || null,
          userId,
          req.method || '',
          path,
          status,
          duration,
          (err && err.message ? err.message : 'unknown').slice(0, 500),
          (err && err.stack ? err.stack : '').slice(0, 4000)
        );
      }
    } catch (_) {}
    if (!res.headersSent) {
      res.status(status).json({
        ok: false,
        reason: 'internal_error',
        requestId: req.id || null,
        detail: err && err.message ? err.message : 'unknown',
      });
    }
  }

  function snapshot() {
    const out = { routes: [] };
    for (const [key, arr] of samplesByRoute.entries()) {
      const sorted = [...arr].sort((a, b) => a - b);
      out.routes.push({
        key,
        count: arr.length,
        p50: _pcent(sorted, 50),
        p95: _pcent(sorted, 95),
        p99: _pcent(sorted, 99),
        max: sorted[sorted.length - 1],
      });
    }
    out.routes.sort((a, b) => (b.p99 || 0) - (a.p99 || 0));
    return out;
  }

  function recentErrors(limit = 50) {
    if (!db || !db._conn) return [];
    return db._conn.prepare("SELECT id, ts, request_id, user_id, method, path, status, duration_ms, message FROM errors_log ORDER BY id DESC LIMIT ?").all(Math.min(500, Math.max(1, limit)));
  }

  return { middleware, errorMiddleware, snapshot, recentErrors, _internal: { samplesByRoute } };
}

module.exports = { createObservability };

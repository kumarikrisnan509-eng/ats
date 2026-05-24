// dr-status.js -- T-385 (architecture audit #1, server.js god-object split).
//
// History
// =======
// T-40   (2026-04): introduced the dr-restore-test.sh cron + the matching
//        POST /api/admin/dr-status reporter endpoint. Token-gated (the host
//        cron has root and reads /etc/ats/.dr-token) so the cron can post
//        from inside docker NAT without needing an admin cookie.
// T-99-T40: defense-in-depth -- if a request arrives WITH x-forwarded-for
//        (i.e. came through nginx from the public internet), token alone
//        is no longer sufficient -- require admin session too. Loopback
//        cron path stays token-only.
// T-99-T65: Telegram alerts on transitions (fail / recovery / long-gap).
// T-385  (2026-05-24): extracted from server.js. The `ensureDrTable`
//        helper is also called from /api/health-deep and /api/system/info
//        in server.js so it's exported alongside the mount function.
//
// Public API
// ==========
//   const { mountDrStatusRoutes, ensureDrTable } = require('./routes/dr-status');
//   mountDrStatusRoutes(app, { getDb, express });
//   ensureDrTable(getDb());    // returns true if the table is ready
//
// `getDb` is a function (not the db value) because db is lazily initialized
// inside server.js's async init() -- passing it as a closure ensures we
// always see the latest value, not a snapshot from module-load time.
//
// `express` is injected so we don't need to require it twice (server.js
// already has the singleton).

'use strict';

const fs = require('fs');
const { notify } = require('../notify');

function ensureDrTable(db) {
  if (!db || !db._conn) return false;
  try {
    db._conn.exec(`CREATE TABLE IF NOT EXISTS dr_test_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts TEXT NOT NULL DEFAULT (datetime('now')),
      ok INTEGER NOT NULL DEFAULT 0,
      rto_sec INTEGER,
      payload TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_dr_test_ts ON dr_test_history(ts DESC);
    CREATE TRIGGER IF NOT EXISTS trim_dr_test_history AFTER INSERT ON dr_test_history BEGIN DELETE FROM dr_test_history WHERE id < (SELECT MAX(id)-100 FROM dr_test_history); END;`);
    return true;
  } catch (e) { console.warn('[dr-status] dr_test_history init failed:', e.message); return false; }
}

function _readToken() {
  try { return fs.readFileSync(process.env.DR_TOKEN_PATH || '/etc/ats/.dr-token', 'utf8').trim(); }
  catch (_) { return null; }
}

function _tokenOk(req) {
  const expected = _readToken();
  const provided = (req.headers['x-ats-dr-token'] || '').toString().trim();
  return expected && expected !== 'unset' && provided === expected;
}

function _publicRequestNeedsAdmin(req) {
  // T-99-T40: came-through-nginx detection. XFF present = public request ->
  // require admin session in addition to token. Absent = direct loopback
  // from host cron -> token alone is sufficient (caller already has root
  // on the host to read the token file).
  const cameThroughProxy = !!(req.headers['x-forwarded-for'] || req.headers['x-real-ip']);
  if (!cameThroughProxy) return false;
  return !(req.user && req.user.is_admin);
}

function mountDrStatusRoutes(app, deps) {
  const { getDb, express } = deps;
  if (typeof getDb !== 'function') throw new Error('dr-status: getDb getter required');
  if (!express) throw new Error('dr-status: express required');

  // POST /api/admin/dr-status -- record a DR test result.
  app.post('/api/admin/dr-status', express.json({ limit: '16kb' }), (req, res) => {
    try {
      if (!_tokenOk(req)) {
        return res.status(401).json({ ok: false, reason: 'dr_auth_failed' });
      }
      if (_publicRequestNeedsAdmin(req)) {
        return res.status(403).json({ ok: false, reason: 'dr_public_requires_admin' });
      }
      const db = getDb();
      if (!ensureDrTable(db)) return res.status(503).json({ ok: false, reason: 'db_not_ready' });
      const body = req.body || {};
      const ok = body.ok === true || body.ok === 'true' ? 1 : 0;
      const rto_sec = Number(body.rto_total_sec) || null;

      // T-99-T65: peek at the previous result so we can detect transitions
      // (fail -> fail = silent, fail -> ok = recovery alert, ok -> fail = critical).
      let prevOk = null, prevTs = null;
      try {
        const prev = db._conn.prepare(`SELECT ok, ts FROM dr_test_history ORDER BY id DESC LIMIT 1`).get();
        if (prev) { prevOk = prev.ok; prevTs = prev.ts; }
      } catch (_) { /* first run; prev stays null */ }

      db._conn.prepare(`INSERT INTO dr_test_history (ok, rto_sec, payload) VALUES (?, ?, ?)`)
        .run(ok, rto_sec, JSON.stringify(body));

      // T-99-T65: Telegram alerts on transitions.
      try {
        if (ok === 0) {
          notify('error', 'ATS DR backup test FAILED', {
            body: 'sudo /opt/ats/scripts/dr-restore-test.sh exited non-zero. Restore path is at risk. Check /var/log/ats/dr-restore-test.log for details.',
            fields: {
              rto_sec: String(rto_sec || 'unknown'),
              time: new Date().toISOString(),
              error: String(body.error || body.reason || '(see log)').slice(0, 200),
            },
            url: 'https://ats.rajasekarselvam.com/api/health-deep',
          }).catch(e => console.warn('[dr-status] promise rejected:', e && e.message));
        } else if (ok === 1 && prevOk === 0) {
          notify('success', 'ATS DR backup test recovered', {
            body: 'After a previous failure, the DR restore test passed again. Backups are verified restorable.',
            fields: { rto_sec: String(rto_sec || 'unknown'), time: new Date().toISOString() },
          }).catch(e => console.warn('[dr-status] promise rejected:', e && e.message));
        } else if (ok === 1 && prevTs) {
          const ageMs = Date.now() - new Date(prevTs).getTime();
          if (ageMs > 35 * 86400 * 1000) {
            notify('warn', 'ATS DR backup test ran after long gap', {
              body: `Previous test was ${Math.round(ageMs/86400000)} days ago. Cron may have been disabled or failing silently.`,
              fields: { rto_sec: String(rto_sec || 'unknown'), time: new Date().toISOString() },
            }).catch(e => console.warn('[dr-status] promise rejected:', e && e.message));
          }
        }
      } catch (_) { /* notify must never break dr-status recording */ }

      res.json({ ok: true, recorded: true });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'dr_record_failed', detail: e.message });
    }
  });

  // GET /api/admin/dr-status -- last 10 test summaries
  app.get('/api/admin/dr-status', (req, res) => {
    try {
      if (!_tokenOk(req)) {
        return res.status(401).json({ ok: false, reason: 'dr_auth_failed' });
      }
      if (_publicRequestNeedsAdmin(req)) {
        return res.status(403).json({ ok: false, reason: 'dr_public_requires_admin' });
      }
      const db = getDb();
      if (!db || !db._conn) return res.status(503).json({ ok: false, reason: 'db_not_ready' });
      const rows = db._conn.prepare(`SELECT id, ts, ok, rto_sec, payload FROM dr_test_history ORDER BY id DESC LIMIT 10`).all();
      res.json({ ok: true, recent: rows.map(r => ({ ...r, payload: (() => { try { return JSON.parse(r.payload); } catch (_) { return null; } })() })) });
    } catch (e) {
      res.status(500).json({ ok: false, reason: 'dr_query_failed', detail: e.message });
    }
  });
}

module.exports = { mountDrStatusRoutes, ensureDrTable };

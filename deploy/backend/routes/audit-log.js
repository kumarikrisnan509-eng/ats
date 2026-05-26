// audit-log.js -- T-408 (architecture audit #1, server.js split #37).
// GET /api/audit?since=ISO&event=order.dryRun&limit=50
// Read-only paginated view of the JSONL audit log (file rotated daily by logrotate).

'use strict';

const fs = require('fs');

function mountAuditLogRoutes(app, deps) {
  const { AUDIT_LOG } = deps;
  if (typeof AUDIT_LOG !== 'string' || !AUDIT_LOG) throw new Error('audit-log: AUDIT_LOG path required');

  app.get('/api/audit', (req, res) => {
    try {
      if (!fs.existsSync(AUDIT_LOG)) return res.json({ ok: true, rows: [], note: 'no audit log yet' });
      const limit  = Math.max(1, Math.min(500, parseInt(req.query.limit || '50', 10) || 50));
      const sinceQ = req.query.since ? new Date(String(req.query.since)).getTime() : 0;
      const eventQ = typeof req.query.event === 'string' ? String(req.query.event) : null;

      // T-424 (audit-2026-05-26 backend C5): per-user filter. Old code
      // returned ALL audit lines (every user's order placements, OAuth
      // callbacks, 2FA tokens, etc.) to any logged-in user. Now: a
      // session-authenticated request only sees lines whose data.userId
      // matches the requester's id. The ops-bearer caller (server.js
      // authMiddleware) sees everything -- that path is for CLI/CI use.
      const sessionUserId = (req.user && req.user.id != null) ? String(req.user.id) : null;
      const isAdmin = !!(req.user && req.user.is_admin);
      const filterByUser = sessionUserId && !isAdmin;

      const raw = fs.readFileSync(AUDIT_LOG, 'utf8');
      const lines = raw.split('\n').filter(Boolean);
      const rows = [];
      for (let i = lines.length - 1; i >= 0 && rows.length < limit; i--) {
        let obj;
        try { obj = JSON.parse(lines[i]); } catch { continue; }
        if (!obj || !obj.ts) continue;
        if (sinceQ && new Date(obj.ts).getTime() < sinceQ) break;
        if (eventQ && obj.event !== eventQ) continue;
        // T-424 (C5): drop lines that do not belong to this user.
        if (filterByUser) {
          const lineUserId = obj.data && (obj.data.userId != null ? String(obj.data.userId) : null);
          if (lineUserId !== sessionUserId) continue;
        }
        rows.push(obj);
      }
      res.json({ ok: true, count: rows.length, rows });
    } catch (e) {
      res.status(500).json({ ok: false, reason: e.message });
    }
  });
}

module.exports = { mountAuditLogRoutes };
